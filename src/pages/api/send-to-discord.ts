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
  const {
    filename,
    imageBase64,
    fileBase64,
    templateName,
    userLogin,
    contentType,
    embedTitle,
    embedDescription,
    embedFields,
  } = req.body || {};
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).json({ error: 'Missing DISCORD_WEBHOOK_URL' });
  const base64Payload: string | undefined = fileBase64 || imageBase64;
  if (!filename || !base64Payload) return res.status(400).json({ error: 'Missing payload' });

  try {
    const buffer = Buffer.from(base64Payload, 'base64');
    const resolvedContentType = typeof contentType === 'string' && contentType.length > 0
      ? contentType
      : fileBase64
      ? 'application/octet-stream'
      : 'image/png';
    const form = new FormData();

    const now = new Date();
    const sanitizeField = (field: any) => {
      if (!field || typeof field !== 'object') return null;
      const name = typeof field.name === 'string' ? field.name : String(field.name || '');
      const value = typeof field.value === 'string' ? field.value : String(field.value || '');
      if (!name || !value) return null;
      return {
        name: name.slice(0, 256),
        value: value.slice(0, 1024),
        inline: Boolean(field.inline),
      };
    };

    const defaultFields = [
      { name: 'Funkcjonariusz wystawiający', value: userLogin || '—', inline: false },
      { name: 'Data i godzina', value: now.toLocaleString('pl-PL'), inline: false },
      { name: 'Typ dokumentu', value: templateName || '—', inline: false },
    ];

    const providedFields = Array.isArray(embedFields)
      ? embedFields
          .map(sanitizeField)
          .filter((field): field is { name: string; value: string; inline: boolean } => Boolean(field))
      : null;

    const embed: Record<string, any> = {
      title: embedTitle || 'Sukces',
      description: embedDescription || '**Do archiwum spłynął dokument**',
      color: 0x2ECC71,
      fields: providedFields && providedFields.length > 0 ? providedFields : defaultFields,
      footer: { text: 'DPS • Panel dokumentów' },
    };

    if (resolvedContentType.startsWith('image/')) {
      embed.image = { url: `attachment://${filename}` };
    }

    const payload = { embeds: [embed] };

    form.append('payload_json', JSON.stringify(payload));
    form.append('file', new Blob([buffer], { type: resolvedContentType }), filename);

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
