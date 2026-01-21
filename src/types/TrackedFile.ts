export interface TrackedFileEntry {
  id: string;
  sourcePath: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedFileIndex {
  version: string;
  entries: TrackedFileEntry[];
}
