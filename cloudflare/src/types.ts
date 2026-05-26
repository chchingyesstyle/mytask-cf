export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  JWT_SECRET_KEY: string;
  ADMIN_PASSWORD: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
};

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  created_at: string;
};

export type ProjectRow = {
  id: number;
  name: string;
  owner_id: number;
  created_at: string;
};

export type TagRow = {
  id: number;
  name: string;
  color: string;
  created_at: string;
};

export type StatusRow = {
  id: number;
  name: string;
  color: string;
  position: number;
  project_id: number | null;
};

export type TaskRow = {
  id: number;
  title: string;
  status: string;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  project_id: number | null;
  notes: string | null;
  owner_id: number;
  parent_id: number | null;
  status_id: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_name?: string | null;
  status_name?: string | null;
  status_color?: string | null;
};

export type KBDocumentRow = {
  id: number;
  title: string;
  filename: string;
  file_type: string;
  file_size: number;
  extracted_text: string | null;
  task_id: number | null;
  owner_id: number;
  created_at: string;
};

export type AppVariables = {
  currentUser: UserRow;
};
