import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

type TypeSummaryEntry = {
  label?: string;
  count?: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { filename, pdfBase64, generatedBy, generatedAt, documentCount, typeSummary } = req.body || {};
  const webhook = process.env.DISCORD_WEBHOOK_URL;

  if (!webhook) {
    return res.status(500).json({ error: "Missing DISCORD_WEBHOOK_URL" });
  }

  if (!pdfBase64) {
    return res.status(400).json({ error: "Missing PDF payload" });
  }

  const safeFilename = typeof filename === "string" && filename.trim().length > 0 ? filename.trim() : "raport-archiwum.pdf";

  try {
    const buffer = Buffer.from(pdfBase64, "base64");
    const form = new FormData();

    const generatedDate = generatedAt ? new Date(generatedAt) : new Date();
    const isValidDate = !Number.isNaN(generatedDate.getTime());
    const generatedLabel = isValidDate ? generatedDate.toLocaleString("pl-PL") : new Date().toLocaleString("pl-PL");

    const summaryEntries = Array.isArray(typeSummary)
      ? (typeSummary as TypeSummaryEntry[]).filter((entry) => typeof entry?.label === "string" && typeof entry?.count === "number")
      : [];

    const summaryLines = summaryEntries.map((entry) => `• ${entry.count}× ${entry.label}`);
    let summaryText = summaryLines.join("\n");
    if (summaryText.length > 1000) {
      summaryText = `${summaryText.slice(0, 997)}…`;
    }

    const fields = [
      { name: "Wygenerował", value: typeof generatedBy === "string" && generatedBy.trim() ? generatedBy.trim() : "—", inline: false },
      { name: "Data i godzina", value: generatedLabel, inline: false },
      {
        name: "Liczba dokumentów",
        value: typeof documentCount === "number" && Number.isFinite(documentCount) ? String(documentCount) : "—",
        inline: true,
      },
    ];

    if (summaryText) {
      fields.push({ name: "Rodzaje dokumentów", value: summaryText, inline: false });
    }

    const payload = {
      embeds: [
        {
          title: "Raport archiwum",
          description: "Wygenerowano raport z wybranych dokumentów archiwum.",
          color: 0x1f8b4c,
          fields,
          footer: { text: "DPS • Panel dokumentów" },
        },
      ],
    };

    form.append("payload_json", JSON.stringify(payload));
    form.append("file", new Blob([buffer], { type: "application/pdf" }), safeFilename);

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
