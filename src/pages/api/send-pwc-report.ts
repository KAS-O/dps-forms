import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

type DiscordPayload = {
  filename?: string;
  fileBase64?: string;
  metadata?: {
    pwcName?: string;
    apwcName?: string;
    duration?: string;
    startTime?: string;
    endTime?: string;
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { filename, fileBase64, metadata }: DiscordPayload = req.body || {};
  const webhook = process.env.DISCORD_PWC_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

  if (!webhook) {
    return res.status(500).json({ error: "Missing DISCORD_PWC_WEBHOOK_URL" });
  }

  if (!filename || !fileBase64) {
    return res.status(400).json({ error: "Missing payload" });
  }

  try {
    const buffer = Buffer.from(fileBase64, "base64");
    const form = new FormData();

    const payload = {
      embeds: [
        {
          title: "Nowy raport PWC",
          description: "Generator raportu PWC zapisał nowy wpis.",
          color: 0x0ea5e9,
          fields: [
            { name: "PWC", value: metadata?.pwcName || "—", inline: true },
            { name: "APWC", value: metadata?.apwcName || "—", inline: true },
            { name: "Czas służby", value: metadata?.duration || "—", inline: true },
            { name: "Początek", value: metadata?.startTime || "—", inline: true },
            { name: "Zakończenie", value: metadata?.endTime || "—", inline: true },
          ],
          footer: { text: "DPS • Patrol Watch Commander" },
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
