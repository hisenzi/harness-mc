"use client";

import { useMemo, useState } from "react";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SearchItemType,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";

type LocalSearchDialogProps = SharedProps & {
  links?: [string, string][];
  corpus?: Record<string, string>;
};

export default function MorroWiseSearchDialog({ open, onOpenChange, links = [], corpus = {} }: LocalSearchDialogProps) {
  const [search, setSearch] = useState("");
  const items = useMemo<SearchItemType[]>(() => {
    const query = search.trim().toLocaleLowerCase();
    return links
      .filter(([name, url]) => query.length === 0 || `${name}\n${corpus[url] ?? ""}`.toLocaleLowerCase().includes(query))
      .map(([name, url], index) => ({
        type: "page" as const,
        id: `${index}:${name}`,
        content: name,
        url,
      }));
  }, [links, search, corpus]);

  return (
    <SearchDialog open={open} onOpenChange={onOpenChange} search={search} onSearchChange={setSearch} isLoading={false}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={items} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
