import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

type PwcReportMetadata = {
  pwc?: string;
  apwc?: string;
  totalMinutes?: number;
  reportDate?: string;
  generatedBy?: string;
};

type Payload = {
  filename?: string;
  fileBase64?: string;
  metadata?: PwcReportMetadata;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { filename, fileBase64, metadata }: Payload = req.body || {};
  const webhook = process.env.DISCORD_WEBHOOK_URL;

  if (!webhook) {
    return res.status(500).json({ error: "Missing DISCORD_WEBHOOK_URL" });
  }

  if (!filename || !fileBase64) {
    return res.status(400).json({ error: "Missing payload" });
  }

  try {
    const buffer = Buffer.from(fileBase64, "base64");
    const form = new FormData();

    const summaryFields = [
      { name: "PWC", value: metadata?.pwc || "—", inline: true },
      { name: "APWC", value: metadata?.apwc || "—", inline: true },
      { name: "Data służby", value: metadata?.reportDate || "—", inline: true },
      {
        name: "Łączny czas",
        value:
          metadata?.totalMinutes != null
            ? `${Math.floor((metadata.totalMinutes || 0) / 60)} h ${(metadata.totalMinutes || 0) % 60} min`
            : "—",
        inline: true,
      },
      { name: "Wygenerował", value: metadata?.generatedBy || "—", inline: true },
    ];

    const payload = {
      embeds: [
        {
          title: "Nowy raport PWC",
          description: "**Wygenerowano raport PWC — Patrol Watch Commander.**",
          color: 0xf472b6,
          fields: summaryFields,
          footer: { text: "DPS • Mobile Data Terminal" },
        },
      ],
    };

    form.append("payload_json", JSON.stringify(payload));
    form.append("file", new Blob([buffer], { type: "application/pdf" }), filename);

    const response = await fetch(webhook, { method: "POST", body: form as any });
    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: "Discord error", details: text });
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Internal error" });
  }
}
