/**
 * Cloudflare Pages Function — POST /api/contact
 *
 * Variables d'environnement (Settings → Variables and secrets, Production) :
 *   BREVO_API_KEY  clé API Brevo (type Secret)
 *   CONTACT_TO     une ou plusieurs adresses destinataires, séparées par des virgules
 *                  ex. : premiere@gmail.com,deuxieme@gmail.com
 *   CONTACT_FROM   adresse expéditrice authentifiée chez Brevo (contact@domaine)
 *   SITE_NAME      nom du blog, affiché dans l'objet du message
 *
 * Aucune donnée n'est stockée : le message est relayé puis oublié.
 * Chaque destinataire reçoit son propre exemplaire : si une boîte bloque ou
 * filtre le message, l'autre le reçoit quand même.
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

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

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
  if (!EMAIL_RE.test(email))
    return json({ error: "Cette adresse e-mail ne semble pas valide." }, 400);
  if (!d.ok)
    return json({ error: "Merci de cocher la case de consentement." }, 400);
  if (message.length < 10)
    return json({ error: "Votre message est un peu court." }, 400);

  const site = env.SITE_NAME || "Blog";
  const dests = (env.CONTACT_TO || "")
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter((a) => EMAIL_RE.test(a));
  const from = env.CONTACT_FROM || dests[0];

  if (!env.BREVO_API_KEY || dests.length === 0)
    return json(
      { error: "Le formulaire n'est pas encore configuré. Réessayez un peu plus tard." },
      503
    );

  const ip = request.headers.get("cf-connecting-ip") || "inconnue";
  const date = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

  const html =
    `<p><strong>Sujet :</strong> ${esc(sujet)}</p>` +
    `<p><strong>De :</strong> ${esc(nom)} &lt;${esc(email)}&gt;</p>` +
    `<hr><p>${esc(message).replace(/\n/g, "<br>")}</p>` +
    `<hr><p style="color:#888;font-size:12px">Envoyé depuis le formulaire de ${esc(site)} ` +
    `le ${esc(date)} — IP ${esc(ip)}. Pour répondre, utilisez simplement « Répondre ».</p>`;

  const text =
    `Sujet : ${sujet}\n` +
    `De : ${nom} <${email}>\n` +
    `----------------------------------------\n` +
    `${message}\n` +
    `----------------------------------------\n` +
    `Envoyé depuis le formulaire de ${site} le ${date} — IP ${ip}.\n` +
    `Pour répondre, utilisez simplement « Répondre ».`;

  const subject = `[${site}] ${sujet} — ${nom}`;

  // Un envoi séparé par destinataire.
  const results = await Promise.all(
    dests.map(async (to) => {
      try {
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
            subject,
            htmlContent: html,
            textContent: text,
            tags: ["formulaire-contact"],
          }),
        });
        if (!r.ok) {
          console.log(`Brevo ${r.status} pour ${to} : ${await r.text()}`);
          return false;
        }
        return true;
      } catch (e) {
        console.log(`Brevo injoignable pour ${to} : ${e}`);
        return false;
      }
    })
  );

  // Il suffit qu'un exemplaire parte pour que le message soit reçu.
  if (!results.some(Boolean)) {
    return json(
      { error: "L'envoi a échoué. Merci de réessayer dans quelques minutes." },
      502
    );
  }
  return json({ ok: true });
}

export function onRequestGet() {
  return json({ error: "Méthode non autorisée." }, 405);
}
