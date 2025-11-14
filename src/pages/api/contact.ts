// src/pages/api/contact.ts
import type { APIRoute } from 'astro';
import { Resend } from 'resend';

// Initialise Resend avec votre clé API (voir étape 3)
const resend = new Resend(import.meta.env.RESEND_API_KEY);

export const POST: APIRoute = async ({ request }) => {
    try {
        // Récupère les données envoyées depuis le client
        const data = await request.json();

        // Validez les données (c'est une bonne pratique de re-valider côté serveur)
        const { message, prenom, nom, email, telephone } = data;
        if (!message || !prenom || !nom || !email) {
            return new Response(JSON.stringify({
                message: "Champs requis manquants."
            }), { status: 400 });
        }

        // 3. Envoyer l'email !
        await resend.emails.send({
            from: 'Portfolio <onboarding@resend.dev>', // Email de l'expéditeur (doit être un domaine vérifié chez Resend, mais celui-ci marche pour les tests)
            to: 'VOTRE_PROPRE_ADRESSE@email.com',   // <-- ⚠️ REMPLACEZ PAR VOTRE EMAIL
            replyTo: email, // Permet de "Répondre à" l'email du visiteur
            subject: `Nouveau message de ${prenom} ${nom} depuis le portfolio`,
            
            // Le contenu de l'email
            html: `
                <h1>Nouveau message de contact</h1>
                <p><strong>De:</strong> ${prenom} ${nom}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Téléphone:</strong> ${telephone || 'Non fourni'}</p>
                <hr>
                <p><strong>Message:</strong></p>
                <p style="white-space: pre-wrap;">${message}</p>
            `
        });

        // 4. Répondre au client que tout s'est bien passé
        return new Response(JSON.stringify({
            message: "Email envoyé avec succès"
        }), { status: 200 });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({
            message: "Erreur lors de l'envoi de l'email."
        }), { status: 500 });
    }
};