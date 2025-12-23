export interface ServerCategory {
  name: string;
  servers: string[];
}

export const SERVER_CATEGORIES: ServerCategory[] = [
  {
    name: "West Africa",
    servers: [
      "burkinafaso",
      "ghana",
      "guinee",
      "guinee-old",
      "liberia",
      "mali",
      "nigeria",
      "nigeria3",
      "nigeria4",
      "nigeria6",
      "senegal",
      "sierraleone"
    ]
  },
  {
    name: "East Africa",
    servers: ["ethiopia", "somalia", "somaliland", "uganda", "zambia"]
  },
  {
    name: "Central Africa",
    servers: ["cameroun", "rdc"]
  },
  {
    name: "Asia",
    servers: ["afghanistan"]
  },
  {
    name: "Caribbean",
    servers: ["haiti"]
  },
  {
    name: "None / Utility / Testing",
    servers: ["demo", "demo-fr", "testing"]
  }
];

export function getCategoryForServer(serverId: string): string {
  const category = SERVER_CATEGORIES.find(cat =>
    cat.servers.includes(serverId)
  );
  return category?.name || "Uncategorized";
}
