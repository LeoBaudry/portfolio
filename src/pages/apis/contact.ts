// src/pages/apis/contact.ts
import type { APIRoute } from 'astro';

// ⬇️ ON IMPORTE TA CONNEXION PARTAGÉE ⬇️
// (Tu dois ajuster le chemin pour pointer vers ton fichier pb.ts)
// Si pb.ts est dans src/lib/ par exemple :
import pb from '../../lib/pb/pb.ts'; 

export const prerender = false;

// ❌ ON SUPPRIME ÇA, ÇA VIENT DE L'IMPORT ❌
// const pb = new PocketBase('http://localhost:8090');
// pb.autoCancellation(false);

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        
        const { message, prenom, nom, email, telephone } = data;
        
        if (!message || !prenom || !nom || !email) {
            return new Response(JSON.stringify({
                message: "Champs requis manquants."
            }), { status: 400 });
        }

        // ⬇️ ÇA NE CHANGE PAS, ÇA UTILISE LE 'pb' IMPORTÉ ⬇️
        await pb.collection('contact').create({
            message,
            prenom,
            nom,
            email,
            telephone: telephone || ''
        });

        return new Response(JSON.stringify({
            message: "Message enregistré avec succès"
        }), { status: 200 });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({
            message: "Erreur lors de l'enregistrement."
        }), { status: 500 });
    }
};