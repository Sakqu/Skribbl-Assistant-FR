# 🎨 Skribbl Assistant FR

Améliorez votre expérience de jeu sur *Skribbl.io* avec ce script qui facilite la détection des mots et l'auto-complétion.

---

## 🚀 Fonctionnalités

✅ **Détection automatique des mots** : Le script récupère les mots possibles en fonction des lettres visibles.  
✅ **Recherche sans accents** : Tapez `elephant` pour trouver *éléphant*, `creme` pour *crème*.  
✅ **Complétion au clavier** : La fin du mot s'affiche en gris dans le champ, <kbd>Tab</kbd> la complète.  
✅ **Réponse automatique optionnelle** : Rien n'est envoyé sans votre accord — le mode *Envoi auto* est désactivé par défaut, et son rythme est irrégulier.  
✅ **Sauvegarde des nouveaux mots** : Les nouveaux mots découverts sont stockés pour enrichir votre base de données.  
✅ **Interface interactive** : Un panneau flottant affiche les suggestions, cliquables pour les envoyer.  
✅ **Exportation des mots** : Vous pouvez télécharger la liste des nouveaux mots ajoutés.  
✅ **Intégré au jeu** : Le panneau reprend le thème de *Skribbl* (couleurs, police Nunito, arrondis) et suit ses changements de thème.  
✅ **Discret par défaut** : Une seule ligne de suggestions à faire défiler ; agrandissable d'un clic.  
✅ **Accessible au clavier** : Les suggestions se parcourent au <kbd>Tab</kbd> et s'envoient avec <kbd>Entrée</kbd> ou <kbd>Espace</kbd>.  

---

## 📌 Installation

### 1️⃣ Installer Tampermonkey
Assurez-vous d'avoir l'extension **Tampermonkey** installée sur votre navigateur :  
🔗 [Télécharger Tampermonkey](https://www.tampermonkey.net/)

### 2️⃣ Ajouter le script
1. Ouvrez le tableau de bord **Tampermonkey**.  
2. Créez un **nouveau script**.  
3. Copiez-collez le code de ce dépôt dans l'éditeur.  
4. **Enregistrez** le script.  

---

## 🎮 Utilisation

Le panneau s'affiche en bas de l'écran, sur **une seule ligne** : il reprend les couleurs, la police et les arrondis de skribbl, et suit automatiquement le thème du jeu (clair, sombre, événementiel). Par défaut, **le script ne fait que suggérer** : aucun mot n'est envoyé dans le chat tant que vous ne cliquez pas dessus.

| Contrôle | Effet |
|---|---|
| 🖱️ **Clic sur une suggestion** | Envoie ce mot dans le chat |
| <kbd>Tab</kbd> | Complète le champ avec la meilleure suggestion (sans l'envoyer) |
| <kbd>Entrée</kbd> | Envoie ce que **vous** avez tapé |
| **Envoi auto** | Envoie les mots tout seul, un par un |
| **2-4 s / 4-8 s / …** | Chaque envoi attend une durée **au hasard** dans la plage choisie |
| **Entrée = suggestion** | La touche <kbd>Entrée</kbd> envoie la meilleure suggestion au lieu de ce que vous avez tapé |
| **Fautes tolérées** | Retrouve un mot même avec une faute de frappe, et cherche aussi au milieu des mots |
| **Réduire en dessinant** | Revient à une ligne pendant votre tour de dessin (activé par défaut) |
| **Exporter** | Télécharge les nouveaux mots découverts |
| **▴ / ▾** | Agrandit le panneau, ou revient à une ligne |

Les réglages sont mémorisés d'une partie à l'autre.

**Sur une ligne** (par défaut), les suggestions défilent horizontalement — le panneau ne prend qu'une fine bande en bas de l'écran. Un clic sur **▴** l'agrandit sur plusieurs lignes, avec défilement vertical pour parcourir tous les mots ; **▾** revient à une ligne.

**Pendant votre tour de dessin**, le script se met en pause : le compteur affiche *en pause · votre tour* et le panneau revient à une ligne (bouton **Réduire en dessinant**). Les suggestions restent cliquables — rien n'est jamais bloqué.

**À côté du compteur** s'affiche le nombre de lettres du mot cherché et le nombre de lettres déjà révélées.

**Dans les suggestions**, la partie que vous avez déjà tapée apparaît estompée — seule la fin du mot ressort. La suggestion mise en avant est celle que <kbd>Tab</kbd> complétera.

**Le mode Fautes tolérées** est utile quand vous n'êtes pas sûr de l'orthographe : `eleohant` retrouve *éléphant*, et `phon` retrouve *téléphone*. Les correspondances exactes restent toujours affichées en premier.

**L'envoi automatique n'a pas de rythme fixe** : chaque envoi attend une durée tirée au hasard dans la plage choisie. Deux envois d'affilée ne tombent donc jamais au même intervalle.

---

## 📬 Contact

Besoin d'aide ou avez-vous des questions ?  
📩 Contactez-moi via **GitHub** !

---

✨ *Amusez-vous bien sur Skribbl.io avec Skribbl Assistant FR !*
