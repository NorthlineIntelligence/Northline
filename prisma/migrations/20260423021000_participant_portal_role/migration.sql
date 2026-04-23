-- Participant role for customer portal access and user admin rights.
CREATE TYPE "ParticipantPortalRole" AS ENUM ('NONE', 'PORTAL_USER', 'ORG_ADMIN');

ALTER TABLE "Participant"
  ADD COLUMN "portal_role" "ParticipantPortalRole" NOT NULL DEFAULT 'NONE';
