# Media Grid + Firebase / Firestore

Cette version utilise le projet Firebase existant `kidflix-953e1`.

## Ce que fait la page

- ouverture directe sur la grille ;
- 2 colonnes sur téléphone, 3 sur grand écran ;
- petit bouton `+` en haut à droite ;
- publication par URL, iframe, embed ou BBCode ;
- connexion Firebase anonyme automatique ;
- publications enregistrées dans Firestore, collection `guest_posts` ;
- synchronisation en temps réel entre les visiteurs.

## Fichiers à mettre sur GitHub

Téléverser à la racine :
- index.html
- style.css
- script.js
- firebase-config.js

Le fichier `firestore.rules` est fourni uniquement comme copie des règles à publier dans
Firebase Console > Firestore Database > Rules.

## Firebase Authentication

Dans Firebase Console :
Authentication > Sign-in method > Anonymous doit être activé.

## Important

Certains sites bloquent l'affichage de leurs pages dans une iframe via leurs propres
en-têtes de sécurité. Dans ce cas, la publication peut être enregistrée dans Firestore,
mais l'iframe ne pourra pas être affichée directement sur le site.
