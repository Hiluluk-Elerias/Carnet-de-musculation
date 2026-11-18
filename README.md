# Carnet de musculation

Application web personnelle pour suivre ses séances de musculation, dans l'esprit de Hevy :

- séance série par série, avec la performance précédente en face de chaque série ;
- minuteur de repos lancé en cochant une série, avec l'exercice suivant du bloc (A1 → A2 → A3) ;
- proposition automatique de la séance suivante (double progression selon la difficulté ressentie de 1 à 5) ;
- records (1RM estimé, charge max, volume) et graphique de progression par exercice ;
- programmes et exercices modifiables, séries d'échauffement ;
- calculateur de disques et tableau de pourcentages du 1RM ;
- fonctionne hors ligne et s'installe sur Android (Chrome → « Ajouter à l'écran d'accueil »).

Les données ne sont pas dans ce dépôt public : elles sont enregistrées dans le dépôt privé
`Carnet-de-musculation-data` (`seances.json` et `programmes.json`) grâce à un jeton GitHub saisi dans l'appli.

## Mise en ligne

Settings → Pages → Source : « Deploy from a branch », branche `main`, dossier `/ (root)`.
L'appli est ensuite disponible sur `https://hiluluk-elerias.github.io/Carnet-de-musculation/`.

## Jeton GitHub

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token :

- Repository access : *Only select repositories* → `Carnet-de-musculation-data` ;
- Permissions → Repository permissions → **Contents : Read and write** ;
- choisir une date d'expiration, puis coller le jeton dans l'onglet Réglages de l'appli.

Le jeton reste dans le stockage local du téléphone.

## Fichiers

- `index.html`, `style.css`, `app.js` : l'application (sans dépendance ni compilation) ;
- `sw.js`, `manifest.webmanifest`, `icons/` : installation et fonctionnement hors ligne ;
- `demarrage.json` : exercices et programme proposés au premier lancement, sans jeton.
