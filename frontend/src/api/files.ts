import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchJSON } from "./client";
import type { FileDetail, FileList, FileSort } from "./types";

export const FILES_PAGE_SIZE = 25;

export function useFiles({ sort, page }: { sort: FileSort; page: number }) {
  return useQuery({
    queryKey: ["files", { sort, page }],
    queryFn: () => {
      const query = new URLSearchParams({
        sort,
        limit: String(FILES_PAGE_SIZE),
        offset: String((page - 1) * FILES_PAGE_SIZE),
      });
      return fetchJSON<FileList>(`/api/files?${query.toString()}`);
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useFileDetail(shasum: string) {
  return useQuery({
    queryKey: ["file", shasum],
    queryFn: () => fetchJSON<FileDetail>(`/api/files/${encodeURIComponent(shasum)}`),
    staleTime: 60_000,
  });
}

export function fileDownloadUrl(shasum: string): string {
  return `/api/files/${encodeURIComponent(shasum)}/download`;
}

export function virusTotalUrl(shasum: string): string {
  return `https://www.virustotal.com/gui/file/${shasum}`;
}
