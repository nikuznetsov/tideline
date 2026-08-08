import type { LoadCategory } from "../lib/categories";

export interface Member {
  id: string;
  user_id: string | null;
  email: string | null;
  name: string;
  role_title: string | null;
  capacity_per_day: string;
  tags: string[];
  sort_order: number;
  is_active: boolean;
}

export interface TimelineAllocation {
  id: string;
  member_id: string;
  project_id: string;
  day: string;
  category: LoadCategory;
  note: string | null;
}

export interface TimelineProject {
  id: string;
  code: string;
  name: string;
  lifecycle: string;
}

export interface TimelineMemberDay {
  day: string;
  capacity: string;
  allocated: string;
  free: string;
  is_working: boolean;
  is_absent: boolean;
}

export interface TimelineMember {
  member: Member;
  days: TimelineMemberDay[];
  total_allocated: string;
  total_free: string;
}

export interface TimelineDayTotal {
  day: string;
  free: string;
  capacity: string;
  allocated: string;
  is_working: boolean;
}

export interface TimelineWeek {
  week_start: string;
  is_closed: boolean;
  is_current: boolean;
  is_past: boolean;
  free_total: string;
}

export interface TimelineAbsence {
  member_id: string;
  date_from: string;
  date_to: string;
  kind: string;
}

export interface TimelineResponse {
  date_from: string;
  date_to: string;
  members: TimelineMember[];
  allocations: TimelineAllocation[];
  projects: TimelineProject[];
  absences: TimelineAbsence[];
  non_working_days: string[];
  day_totals: TimelineDayTotal[];
  weeks: TimelineWeek[];
  utilization_pct: number;
  week_close_reminder: string | null;
}

export interface Candidate {
  member: Member;
  free_total: string;
  free_by_day: Record<string, string>;
  warnings: { kind: string; message: string }[];
}

export interface CapacitySearchResult {
  total_free: string;
  needed: string;
  enough: boolean;
  deficit: string;
  candidates: Candidate[];
  plan_horizon_warning: boolean;
}

export interface ProjectListItem {
  id: string;
  code: string;
  name: string;
  lifecycle: string;
  health: string;
  weekly_update: string | null;
  status_updated_at: string | null;
  active_members_count: number;
}

export interface Milestone {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  owner_member_id: string | null;
  sort_order: number;
}

export interface ProjectUpdateEntry {
  id: string;
  body: string;
  health_after: string | null;
  on_date: string;
  author_name: string | null;
  created_at: string;
}

export interface ProjectDetail extends ProjectListItem {
  goal: string | null;
  scope_md: string | null;
  links_md: string | null;
  milestones: Milestone[];
  updates: ProjectUpdateEntry[];
}

export interface ProjectLoad {
  date_from: string;
  date_to: string;
  total_person_days: string;
  rows: { member: Member; person_days: string }[];
}

export interface AccuracyReport {
  weeks_analyzed: number;
  weeks: { week_start: string; plan_total: string; fact_total: string; abs_error: string }[];
  members: { member_id: string; member_name: string; mean_abs_error: string }[];
  idle_weeks_share: number;
  overrun_projects: { project_id: string; code: string; name: string; total_overrun: string }[];
}

export interface ShareLinkItem {
  id: string;
  token_prefix: string;
  scope: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_accessed_at: string | null;
  token?: string;
  url?: string;
}

export interface AbsenceItem {
  id: string;
  member_id: string;
  date_from: string;
  date_to: string;
  kind: string;
  note: string | null;
}

export interface NonWorkingDayItem {
  id: string;
  day: string;
  title: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
}
