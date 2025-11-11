import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { filename, imageBase64, templateName, userLogin } = req.body || {};
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).json({ error: 'Missing DISCORD_WEBHOOK_URL' });
  if (!filename || !imageBase64) return res.status(400).json({ error: 'Missing payload' });

  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const form = new FormData();

    const now = new Date();
    const payload = {
      embeds: [{
        title: "Sukces",
        description: "**Do archiwum spłynął dokument**",
        color: 0x2ECC71,
        fields: [
          { name: "Funkcjonariusz wystawiający", value: userLogin || "—", inline: false },
          { name: "Data i godzina", value: now.toLocaleString('pl-PL'), inline: false },
          { name: "Typ dokumentu", value: templateName || "—", inline: false },
        ],
        image: { url: `attachment://${filename}` },
        footer: { text: "DPS • Mobile Data Terminal" }
      }]
    };

    form.append('payload_json', JSON.stringify(payload));
    form.append('file', new Blob([buffer], { type: 'image/png' }), filename);

    const resp = await fetch(webhook, { method: 'POST', body: form as any });
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ error: 'Discord error', details: text });
    }
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
