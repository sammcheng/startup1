export interface ApiKeyRecord {
  id: string;
  key_prefix: string;
  name: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyCreateResponse {
  id: string;
  key: string;
  key_prefix: string;
  name: string;
}
