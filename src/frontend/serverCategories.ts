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
      "sierraleone",
      "ci",
      "mauritania",
      "niger"
    ]
  },
  {
    name: "East Africa",
    servers: ["ethiopia", "somalia", "somaliland", "uganda", "zambia", "malawi", "kenya"]
  },
  {
    name: "Central Africa",
    servers: ["cameroun", "rdc", "chad", "rca"]
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
    servers: ["demo", "demo-fr", "testing", "testing2"]
  }
];

export const ALL_CATEGORIZED_SERVER_IDS = new Set(
  SERVER_CATEGORIES.flatMap(cat => cat.servers)
);

export function getCategoryForServer(serverId: string): string {
  const category = SERVER_CATEGORIES.find(cat =>
    cat.servers.includes(serverId)
  );
  return category?.name || "Uncategorized";
}
