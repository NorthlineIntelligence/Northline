import { Readable } from "node:stream";
import { google, drive_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";

type DriveClient = drive_v3.Drive;

function env(name: string): string | null {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function getDriveClient(): DriveClient | null {
  const clientEmail = env("GOOGLE_DRIVE_CLIENT_EMAIL");
  const privateKeyRaw = env("GOOGLE_DRIVE_PRIVATE_KEY");
  if (!clientEmail || !privateKeyRaw) return null;

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  return google.drive({ version: "v3", auth });
}

function sanitizeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Organization";
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 180) || "document.txt";
}

async function ensureFolder(
  drive: DriveClient,
  folderName: string,
  parentFolderId?: string | null
): Promise<string> {
  const qParts = [
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `name = '${folderName.replace(/'/g, "\\'")}'`,
  ];
  if (parentFolderId) qParts.push(`'${parentFolderId}' in parents`);

  const existing = await drive.files.list({
    q: qParts.join(" and "),
    fields: "files(id,name)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 1,
  });
  const foundId = existing.data.files?.[0]?.id;
  if (foundId) return foundId;

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error("Drive folder creation failed.");
  return created.data.id;
}

export async function ensureOrganizationDriveFolders(params: {
  organizationId: string;
  organizationName: string;
}): Promise<{
  rootFolderId: string | null;
  libraryFolderId: string | null;
}> {
  const drive = getDriveClient();
  if (!drive) return { rootFolderId: null, libraryFolderId: null };

  const globalParent = env("GOOGLE_DRIVE_ROOT_FOLDER_ID");
  const rootName = `${sanitizeFolderName(params.organizationName)} - ${params.organizationId.slice(0, 8)}`;
  const rootFolderId = await ensureFolder(drive, rootName, globalParent);
  const libraryFolderId = await ensureFolder(drive, "Customer Library", rootFolderId);

  await prisma.organization.update({
    where: { id: params.organizationId },
    data: {
      google_drive_root_folder_id: rootFolderId,
      google_drive_library_folder_id: libraryFolderId,
    },
  });
  return { rootFolderId, libraryFolderId };
}

export async function uploadOrganizationLibraryFile(params: {
  organizationId: string;
  organizationName: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ fileId: string | null; webViewLink: string | null }> {
  const drive = getDriveClient();
  if (!drive) return { fileId: null, webViewLink: null };

  const org = await prisma.organization.findUnique({
    where: { id: params.organizationId },
    select: {
      id: true,
      name: true,
      google_drive_library_folder_id: true,
      google_drive_root_folder_id: true,
    },
  });
  if (!org) return { fileId: null, webViewLink: null };

  let libraryFolderId = org.google_drive_library_folder_id;
  if (!libraryFolderId) {
    const created = await ensureOrganizationDriveFolders({
      organizationId: params.organizationId,
      organizationName: params.organizationName || org.name,
    });
    libraryFolderId = created.libraryFolderId;
  }
  if (!libraryFolderId) return { fileId: null, webViewLink: null };

  const created = await drive.files.create({
    requestBody: {
      name: sanitizeFilename(params.filename),
      parents: [libraryFolderId],
    },
    media: {
      mimeType: params.mimeType,
      body: Readable.from(params.bytes),
    },
    fields: "id,webViewLink",
    supportsAllDrives: true,
  });
  return {
    fileId: created.data.id ?? null,
    webViewLink: created.data.webViewLink ?? null,
  };
}
