# Entités

> Fichier généré par `npm run docs` à partir de `src/ai/specs.ts`. Ne pas modifier à la main.

Vitesses de référence du joueur : marche 2,7 m/s, course 5,1 m/s, accroupi 1,35 m/s.

## Le Visiteur

Ce qui est revenu de la Nuit commune à la place des neuf sujets. Grand, lent tant qu'il observe, il emprunte les voix et les gestes de ceux qu'il a croisés.

| Caractéristique | Valeur |
| --- | --- |
| Territoire | Noyau NOCTURNE, Secteur expérimental |
| Exemplaires par expédition | 1 |
| Vitesse (patrouille / chasse) | 1.9 / 4.6 m/s |
| Vue | 22 m, champ de 120° |
| Ouïe | × 1.2 |
| Sensible à la lumière | oui, jusqu'à 30 m |
| Mémoire d'une piste | 14 s |
| Ouvre les portes | oui |
| Emprunte les conduits | non |
| Enfonce une porte verrouillée | oui |
| Attaque | 36 dégâts (profonde), portée 1.5 m |
| Temps de récupération | 32 s |

**Intelligence.** Élevée. Neuf états (dormant, observation, investigation, imitation, approche, chasse, attaque, disparition, repositionnement) et trois traits tirés à chaque expédition — agressivité, ruse, patience — qui modifient ses choix. Il mémorise les zones où il a perçu des joueurs, remarque les portes déplacées et ne connaît jamais une position qu'il n'a ni vue ni entendue.

**Comportement.** Observe de loin depuis l'ombre et disparaît si on l'éclaire trop longtemps. Imite des pas, des portes, des appels ou un message radio pour isoler quelqu'un. Frappe une fois puis se retire : il revient plus tard, ailleurs. Courant principal rétabli, il perçoit mieux et patiente moins.

**Méthodes d'évasion.** Rompre la ligne de vue puis se cacher (casier, pièce fermée) : il perd la trace au bout d'une quinzaine de secondes. Rester groupés : il n'attaque pas un groupe qui le regarde. Vérifier toute voix au détecteur sonore : une imitation n'a pas de signature organique. Une porte verrouillée ou barricadée le retarde mais ne l'arrête pas.

## L'Écho

Né dans la chambre anéchoïque. Totalement aveugle, il se dirige par cliquetis et fond sur la moindre réponse sonore.

| Caractéristique | Valeur |
| --- | --- |
| Territoire | Laboratoire acoustique |
| Exemplaires par expédition | 1 |
| Vitesse (patrouille / chasse) | 1.6 / 5.6 m/s |
| Vue | aveugle |
| Ouïe | × 2.4 |
| Sensible à la lumière | non |
| Mémoire d'une piste | 9 s |
| Ouvre les portes | oui |
| Emprunte les conduits | non |
| Enfonce une porte verrouillée | oui |
| Attaque | 44 dégâts (traumatisme), portée 1.6 m |
| Temps de récupération | 12 s |

**Intelligence.** Moyenne. Trie les bruits par intensité et par répétition : un bruit isolé l'intrigue, deux bruits au même endroit déclenchent la charge. Son cliquetis révèle tout ce qui bouge à moins de cinq mètres.

**Comportement.** Patrouille lentement en cliquetant. Va écouter l'endroit d'où est venu un bruit, puis charge à 5,6 m/s — plus vite qu'un joueur — si le bruit se répète. Enfonce les portes plutôt que de les ouvrir.

**Méthodes d'évasion.** S'immobiliser dès qu'il cliquette, marcher accroupi, retenir sa respiration quand il passe. Lancer un objet au loin pour le détourner. Ne jamais courir : sa charge rattrape un sprinteur. La lampe ne l'attire pas.

## Le Phototrope

Masse pâle qui dérive dans les secteurs éteints. Elle ne perçoit que la lumière et s'y jette.

| Caractéristique | Valeur |
| --- | --- |
| Territoire | Secteur médical, Archives, Secteur expérimental |
| Exemplaires par expédition | 1 |
| Vitesse (patrouille / chasse) | 1.2 / 4.8 m/s |
| Vue | aveugle |
| Ouïe | × 0.25 |
| Sensible à la lumière | oui, jusqu'à 30 m |
| Mémoire d'une piste | 5 s |
| Ouvre les portes | oui |
| Emprunte les conduits | non |
| Enfonce une porte verrouillée | non |
| Attaque | 28 dégâts (brulure), portée 1.5 m |
| Temps de récupération | 8 s |

**Intelligence.** Faible. Suit la source lumineuse la plus vive en ligne de vue : lampe torche, marqueur lumineux, pièce éclairée. Sans lumière, elle erre.

**Comportement.** Dérive lentement dans le noir. Converge sur toute lampe visible puis charge son porteur ; son contact brûle. Absorbe les marqueurs lumineux qu'elle atteint.

**Méthodes d'évasion.** Éteindre sa lampe : elle perd la cible en quelques secondes et rejoint la dernière lueur vue. Lancer ou déposer un marqueur lumineux comme leurre. Presque sourde : on peut courir dans le noir. Rétablir le courant d'un secteur l'y attire et l'y fixe.

## Le Rampant

Habitant des conduits. On l'entend racler dans les plafonds avant de le voir jaillir d'une grille.

| Caractéristique | Valeur |
| --- | --- |
| Territoire | Maintenance |
| Exemplaires par expédition | 1 |
| Vitesse (patrouille / chasse) | 2.2 / 2.5 m/s |
| Vue | 9 m, champ de 160° |
| Ouïe | × 1.5 |
| Sensible à la lumière | non |
| Mémoire d'une piste | 8 s |
| Ouvre les portes | non |
| Emprunte les conduits | oui |
| Enfonce une porte verrouillée | non |
| Attaque | 24 dégâts (legere), portée 1.5 m |
| Temps de récupération | 26 s |

**Intelligence.** Moyenne. Connaît le réseau de conduits et choisit la grille la plus proche du bruit entendu. Ne sait pas ouvrir une porte.

**Comportement.** Écoute depuis un conduit, rejoint la grille la plus proche d'une proie et attend qu'elle passe à portée pour surgir. À découvert il est lent et renonce après quelques secondes pour regagner une grille.

**Méthodes d'évasion.** Se tenir au milieu des pièces, loin des grilles. Refermer les grilles : il doit les forcer bruyamment. À découvert, marcher suffit à le distancer ; toute porte fermée l'arrête.

## Le Porteur

Ancien sujet recouvert par la Souche. Il ne dort plus, ne court pas, et suit quiconque passe à portée.

| Caractéristique | Valeur |
| --- | --- |
| Territoire | Zone de quarantaine |
| Exemplaires par expédition | 3 |
| Vitesse (patrouille / chasse) | 0.9 / 1.9 m/s |
| Vue | 13 m, champ de 138° |
| Ouïe | × 1 |
| Sensible à la lumière | non |
| Mémoire d'une piste | 20 s |
| Ouvre les portes | non |
| Emprunte les conduits | non |
| Enfonce une porte verrouillée | non |
| Attaque | 14 dégâts (legere), portée 1.3 m |
| Temps de récupération | 3 s |

**Intelligence.** Très faible. Marche vers ce qu’il voit ou entend et ne renonce presque jamais. Incapable d’ouvrir une porte.

**Comportement.** Erre dans la quarantaine et en sort par toute porte laissée ouverte. Son simple voisinage infecte ; son contact blesse et infecte davantage.

**Méthodes d'évasion.** Marcher : il est plus lent qu'un joueur. Fermer les portes derrière soi — une porte fermée l'arrête définitivement. La purge thermique de la quarantaine les détruit tous.

## Le Statique

Présence électromagnétique née des baies de calcul. Presque invisible à l'œil nu, elle traverse les cloisons et se nourrit du courant.

| Caractéristique | Valeur |
| --- | --- |
| Territoire | Serveurs |
| Exemplaires par expédition | 1 |
| Vitesse (patrouille / chasse) | 1.1 / 2.1 m/s |
| Vue | aveugle |
| Ouïe | sourd |
| Sensible à la lumière | non |
| Mémoire d'une piste | 4 s |
| Ouvre les portes | oui |
| Emprunte les conduits | oui |
| Enfonce une porte verrouillée | oui |
| Attaque | 20 dégâts (brulure), portée 2.4 m |
| Temps de récupération | 22 s |

**Intelligence.** Faible. Se dirige vers la plus forte concentration d'appareils allumés dans un rayon de vingt-cinq mètres, sans se soucier des murs.

**Comportement.** Dérive entre les baies. À son approche les lampes faiblissent, la radio grésille et les batteries se vident six fois plus vite. Rester à son contact provoque une décharge qui brûle, après quoi elle se dissipe un moment.

**Méthodes d'évasion.** Éteindre lampe, radio et détecteurs : elle se désintéresse aussitôt. Surveiller l'appareil de mesure, qui signale l'anomalie électromagnétique bien avant le contact. Sortir de son rayon en marchant.
