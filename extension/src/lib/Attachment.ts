export interface Attachment {
  type: "url"
  id: number;
  url: string;
  createdAt: string;
  syncStatus: 'pending' | 'synced';
}
