/**
 * Génère la documentation de contenu à partir des données du jeu, pour qu'elle
 * ne puisse pas diverger du code : npm run docs
 */
import { writeFileSync } from 'node:fs';
import { ENTITY_KINDS, ENTITY_SPECS } from '../src/ai/specs';
import { SOUNDS, soundsByCategory } from '../src/audio/library';
import { ITEMS } from '../src/inventory/items';
import { OBJECTIVES } from '../src/missions/objectives';
import { SECTORS } from '../src/world/sectors';

const out: string[] = [];
const p = (s = ''): void => void out.push(s);

p('# Entités');
p();
p('> Fichier généré par `npm run docs` à partir de `src/ai/specs.ts`. Ne pas modifier à la main.');
p();
p('Vitesses de référence du joueur : marche 2,7 m/s, course 5,1 m/s, accroupi 1,35 m/s.');
for (const kind of ENTITY_KINDS) {
  const s = ENTITY_SPECS[kind];
  p();
  p(`## ${s.name}`);
  p();
  p(s.summary);
  p();
  p('| Caractéristique | Valeur |');
  p('| --- | --- |');
  p(`| Territoire | ${s.home.map((h) => SECTORS.find((x) => x.id === h)!.name).join(', ')} |`);
  p(`| Exemplaires par expédition | ${s.count} |`);
  p(`| Vitesse (patrouille / chasse) | ${s.patrolSpeed} / ${s.huntSpeed} m/s |`);
  p(`| Vue | ${s.visionRange > 0 ? `${s.visionRange} m, champ de ${Math.round((s.visionHalfFov * 2 * 180) / Math.PI)}°` : 'aveugle'} |`);
  p(`| Ouïe | ${s.hearing > 0 ? `× ${s.hearing}` : 'sourd'} |`);
  p(`| Sensible à la lumière | ${s.lightSense > 0 ? `oui, jusqu'à ${s.lightSense} m` : 'non'} |`);
  p(`| Mémoire d'une piste | ${s.memory} s |`);
  p(`| Ouvre les portes | ${s.caps.openDoors ? 'oui' : 'non'} |`);
  p(`| Emprunte les conduits | ${s.caps.vents ? 'oui' : 'non'} |`);
  p(`| Enfonce une porte verrouillée | ${s.caps.breach ? 'oui' : 'non'} |`);
  p(`| Attaque | ${s.attackDamage} dégâts (${s.attackInjury}), portée ${s.attackRange} m |`);
  p(`| Temps de récupération | ${s.recovery} s |`);
  p();
  p(`**Intelligence.** ${s.intelligence}`);
  p();
  p(`**Comportement.** ${s.behaviour}`);
  p();
  p(`**Méthodes d'évasion.** ${s.evasion}`);
}
writeFileSync('docs/ENTITIES.md', out.join('\n') + '\n');

out.length = 0;
p('# Contenu : secteurs, objectifs, équipement, sons');
p();
p('> Fichier généré par `npm run docs`. Ne pas modifier à la main.');
p();
p('## Les douze secteurs');
p();
p('| Secteur | Palier | Sas | Rôle | Risque particulier |');
p('| --- | --- | --- | --- | --- |');
for (const s of SECTORS) p(`| ${s.name} | ${s.tier} | ${s.gateLevel ? `carte niv. ${s.gateLevel}` : 'libre'} | ${s.role} | ${s.hazard} |`);
p();
p(`## Objectifs (${OBJECTIVES.length})`);
for (const kind of ['principal', 'secondaire'] as const) {
  p();
  p(`### ${kind === 'principal' ? 'Principaux' : 'Secondaires'}`);
  for (const o of OBJECTIVES.filter((x) => x.kind === kind)) {
    p();
    p(`#### ${o.id} — ${o.title} (${o.xp} XP)`);
    p();
    p(o.brief);
    p();
    p(`- **Condition de départ :** ${o.start ? `atteindre le secteur ${'sector' in o.start ? o.start.sector : ''}` : "dès le début de l'expédition"}`);
    p('- **Étapes :**');
    o.steps.forEach((s, i) => p(`  ${i + 1}. ${s.label}`));
    p(`- **Réussite :** toutes les étapes accomplies${kind === 'principal' ? ", puis extraction d'au moins un joueur" : ''}.`);
    const fail = o.fail ? (o.fail.type === 'timer' ? `non accompli en ${o.fail.seconds / 60} minutes` : o.fail.type === 'deaths' ? `${o.fail.count} morts dans l'équipe` : `drapeau ${o.fail.name}`) : kind === 'principal' ? "toute l'équipe meurt ou personne ne s'extrait" : 'aucune (reste ouvert)';
    p(`- **Échec :** ${fail}.`);
    p(`- **Conséquence :** ${o.consequenceText}`);
  }
}
p();
p('## Équipement');
p();
p('| Objet | Poids | Empl. | Catégorie | Usage |');
p('| --- | --- | --- | --- | --- |');
for (const i of ITEMS) p(`| ${i.name} | ${i.weight} kg | ${i.size} | ${i.category} | ${i.description} |`);
p();
p(`## Bibliothèque sonore (${Object.keys(SOUNDS).length} sons synthétisés)`);
p();
for (const [cat, ids] of Object.entries(soundsByCategory())) p(`- **${cat}** (${ids.length}) : ${ids.join(', ')}`);
writeFileSync('docs/CONTENT.md', out.join('\n') + '\n');
console.log('docs/ENTITIES.md et docs/CONTENT.md générés');
