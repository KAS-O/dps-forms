import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

type ReportMetadata = {
  generatedBy?: string;
  generatedAt?: string;
  generatedAtDisplay?: string;
  totalDocuments?: number;
  typeSummary?: string;
};

type DiscordWebhookBody = {
  filename?: string;
  fileBase64?: string;
  metadata?: ReportMetadata;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { filename, fileBase64, metadata }: DiscordWebhookBody = req.body || {};
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
      {
        name: "Wygenerował",
        value: metadata?.generatedBy || "—",
        inline: true,
      },
      {
        name: "Data",
        value: metadata?.generatedAtDisplay || metadata?.generatedAt || "—",
        inline: true,
      },
      {
        name: "Liczba dokumentów",
        value: metadata?.totalDocuments != null ? String(metadata.totalDocuments) : "—",
        inline: true,
      },
    ];

    if (metadata?.typeSummary) {
      summaryFields.push({
        name: "Typy dokumentów",
        value: metadata.typeSummary,
        inline: false,
      });
    }

    const payload = {
      embeds: [
        {
          title: "Nowy raport czynności służbowych",
          description: "**Wygenerowano raport czynności służbowych.**",
          color: 0x2980b9,
          fields: summaryFields,
          footer: { text: "DPS • Panel dokumentów" },
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
