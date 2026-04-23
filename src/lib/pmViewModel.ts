export type PmUpdateDto = {
  id: string;
  statusLabel: string;
  whyText: string | null;
  createdAt: string;
  customerVisible: boolean;
  authorEmail?: string | null;
};

export type PmSprintDto = {
  id: string;
  title: string;
  status: string;
  completionPct: number;
  targetEndAt: string | null;
  updates: PmUpdateDto[];
};

export type PmProjectDto = {
  id: string;
  title: string;
  status: string;
  completionPct: number;
  customerSummary: string | null;
  sprints: PmSprintDto[];
};

export function mapProjectForCustomer(project: PmProjectDto): PmProjectDto {
  return {
    ...project,
    sprints: project.sprints.map((s) => ({
      ...s,
      updates: s.updates.filter((u) => u.customerVisible),
    })),
  };
}

