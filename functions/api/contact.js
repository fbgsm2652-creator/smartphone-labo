/**
 * Cloudflare Pages Function — POST /api/contact
 *
 * Variables d'environnement à définir dans Cloudflare Pages
 * (Settings → Environment variables, production ET preview) :
 *   BREVO_API_KEY  clé API du compte d'envoi
 *   CONTACT_TO     adresse destinataire (ex. contact@smartphone-labo.fr)
 *   CONTACT_FROM   adresse expéditrice validée chez le prestataire
 *   SITE_NAME      nom du blog, affiché dans l'objet du message
 *
 * Aucune donnée n'est stockée : le message est relayé puis oublié.
 */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );

export async function onRequestPost({ request, env }) {
  let d;
  try {
    d = await request.json();
  } catch {
    return json({ error: "Requête invalide." }, 400);
  }

  // Piège à robots : champ invisible qui doit rester vide.
  if (d.site) return json({ ok: true });

  const nom = (d.nom || "").toString().trim().slice(0, 80);
  const email = (d.email || "").toString().trim().slice(0, 120);
  const sujet = (d.sujet || "Message").toString().trim().slice(0, 80);
  const message = (d.message || "").toString().trim().slice(0, 4000);

  if (!nom || !email || !message)
    return json({ error: "Merci de remplir tous les champs obligatoires." }, 400);
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email))
    return json({ error: "Cette adresse e-mail ne semble pas valide." }, 400);
  if (!d.ok)
    return json({ error: "Merci de cocher la case de consentement." }, 400);
  if (message.length < 10)
    return json({ error: "Votre message est un peu court." }, 400);

  const site = env.SITE_NAME || "Blog";
  const to = env.CONTACT_TO;
  const from = env.CONTACT_FROM || to;

  if (!env.BREVO_API_KEY || !to)
    return json(
      { error: "Le formulaire n'est pas encore configuré. Écrivez-nous par e-mail." },
      503
    );

  const ip = request.headers.get("cf-connecting-ip") || "inconnue";
  const html =
    `<p><strong>Sujet :</strong> ${esc(sujet)}</p>` +
    `<p><strong>De :</strong> ${esc(nom)} &lt;${esc(email)}&gt;</p>` +
    `<hr><p>${esc(message).replace(/\n/g, "<br>")}</p>` +
    `<hr><p style="color:#888;font-size:12px">Envoyé depuis le formulaire de ${esc(site)} — IP ${esc(ip)}</p>`;

  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: site, email: from },
      to: [{ email: to }],
      replyTo: { email, name: nom },
      subject: `[${site}] ${sujet} — ${nom}`,
      htmlContent: html,
    }),
  });

  if (!r.ok) {
    return json(
      { error: "L'envoi a échoué. Réessayez plus tard ou écrivez-nous par e-mail." },
      502
    );
  }
  return json({ ok: true });
}

export function onRequestGet() {
  return json({ error: "Méthode non autorisée." }, 405);
}
