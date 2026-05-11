// API Route: /api/missions
// Gestion CRUD des missions via Upstash Redis

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured' });
  }

  const kv = async (cmd, ...args) => {
    const r = await fetch(`${KV_URL}/${[cmd, ...args].map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    return d.result;
  };

  // GET - liste toutes les missions ou une mission spécifique
  if (req.method === 'GET') {
    const { id } = req.query;
    if (id) {
      // Récupère une mission par ID
      const data = await kv('GET', `mission:${id}`);
      if (!data) return res.status(404).json({ error: 'Mission not found' });
      return res.status(200).json(JSON.parse(data));
    } else {
      // Liste toutes les missions (index)
      const index = await kv('GET', 'missions:index');
      const list = index ? JSON.parse(index) : [];
      // Récupère les résumés de chaque mission
      const missions = await Promise.all(
        list.map(async (id) => {
          const data = await kv('GET', `mission:${id}:summary`);
          return data ? JSON.parse(data) : null;
        })
      );
      return res.status(200).json(missions.filter(Boolean));
    }
  }

  // POST - sauvegarde une mission
  if (req.method === 'POST') {
    const mission = req.body;
    if (!mission || !mission.id) return res.status(400).json({ error: 'Missing mission data' });

    // Sauvegarde complète
    await fetch(`${KV_URL}/SET/mission:${encodeURIComponent(mission.id)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(mission) })
    });

    // Résumé pour la liste
    const summary = {
      id: mission.id,
      ref: mission.ref,
      immeuble: mission.immeuble,
      adresse: mission.adresse,
      date: mission.date,
      visio_index: mission.report?.visio_index,
      niveau_vigilance: mission.report?.niveau_vigilance,
      nb_anomalies: mission.report?.anomalies?.length || 0,
      budget_min: mission.report?.budget_total_min,
      budget_max: mission.report?.budget_total_max,
      created_at: new Date().toISOString()
    };

    await fetch(`${KV_URL}/SET/mission:${encodeURIComponent(mission.id)}:summary`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(summary) })
    });

    // Mise à jour de l'index
    const index = await kv('GET', 'missions:index');
    const list = index ? JSON.parse(index) : [];
    if (!list.includes(mission.id)) {
      list.unshift(mission.id); // plus récent en premier
      await fetch(`${KV_URL}/SET/missions:index`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(list) })
      });
    }

    return res.status(200).json({ success: true, id: mission.id });
  }

  // DELETE - supprime une mission
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    await kv('DEL', `mission:${id}`);
    await kv('DEL', `mission:${id}:summary`);

    const index = await kv('GET', 'missions:index');
    const list = index ? JSON.parse(index) : [];
    const newList = list.filter(m => m !== id);
    await fetch(`${KV_URL}/SET/missions:index`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(newList) })
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
