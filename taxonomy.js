const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => start + index);

const makeTaxonomy = (group, rows) => rows.map(([key, latin, german, ids]) => ({
  key,
  latin,
  german,
  group,
  ids: ids.flatMap(part => Array.isArray(part) ? range(part[0], part[1]) : part)
}));

const TAXON_FILTERS = {
  plant: makeTaxonomy("plant", [
    ["equisetaceae", "Equisetaceae", "Schachtelhalmgewächse", [[0, 1]]],
    ["dennstaedtiaceae", "Dennstaedtiaceae", "Adlerfarngewächse", [2]],
    ["woodsiaceae", "Woodsiaceae", "Wimperfarngewächse", [3]],
    ["dryopteridaceae", "Dryopteridaceae", "Wurmfarngewächse", [[4, 6]]],
    ["pinaceae", "Pinaceae", "Kieferngewächse", [[7, 11]]],
    ["nymphaeaceae", "Nymphaeaceae", "Seerosengewächse", [[12, 13]]],
    ["ranunculaceae", "Ranunculaceae", "Hahnenfußgewächse", [[14, 18]]],
    ["papaveraceae", "Papaveraceae", "Mohngewächse", [[19, 20]]],
    ["fagaceae", "Fagaceae", "Buchengewächse", [[21, 24]]],
    ["betulaceae", "Betulaceae", "Birkengewächse", [[25, 26]]],
    ["corylaceae", "Corylaceae", "Haselgewächse", [[27, 28]]],
    ["ulmaceae", "Ulmaceae", "Ulmengewächse", [29]],
    ["urticaceae", "Urticaceae", "Brennnesselgewächse", [30]],
    ["caryophyllaceae", "Caryophyllaceae", "Nelkengewächse", [[31, 36]]],
    ["chenopodiaceae", "Chenopodiaceae", "Gänsefußgewächse", [37]],
    ["polygonaceae", "Polygonaceae", "Knöterichgewächse", [[38, 42]]],
    ["hypericaceae", "Hypericaceae", "Hartheugewächse", [43]],
    ["violaceae", "Violaceae", "Veilchengewächse", [[44, 45]]],
    ["brassicaceae", "Brassicaceae", "Kreuzblütengewächse", [[46, 50]]],
    ["salicaceae", "Salicaceae", "Weidengewächse", [[51, 53]]],
    ["tiliaceae", "Tiliaceae", "Lindengewächse", [[54, 55]]],
    ["euphorbiaceae", "Euphorbiaceae", "Wolfsmilchgewächse", [[56, 57]]],
    ["ericaceae", "Ericaceae", "Heidekrautgewächse", [[58, 59]]],
    ["primulaceae", "Primulaceae", "Primelgewächse", [[60, 61]]],
    ["rosaceae", "Rosaceae", "Rosengewächse", [[62, 76]]],
    ["grossulariaceae", "Grossulariaceae", "Stachelbeergewächse", [[77, 78]]],
    ["fabaceae", "Fabaceae", "Schmetterlingsblütengewächse", [[79, 87]]],
    ["aceraceae", "Aceraceae", "Ahorngewächse", [[88, 89]]],
    ["hippocastanaceae", "Hippocastanaceae", "Rosskastaniengewächse", [90]],
    ["balsaminaceae", "Balsaminaceae", "Balsaminengewächse", [[91, 92]]],
    ["oxalidaceae", "Oxalidaceae", "Sauerkleegewächse", [93]],
    ["geraniaceae", "Geraniaceae", "Storchschnabelgewächse", [94]],
    ["onagraceae", "Onagraceae", "Nachtkerzengewächse", [95]],
    ["araliaceae", "Araliaceae", "Araliengewächse", [96]],
    ["apiaceae", "Apiaceae", "Doldenblütengewächse", [[97, 101]]],
    ["celastraceae", "Celastraceae", "Baumwürgergewächse", [102]],
    ["rhamnaceae", "Rhamnaceae", "Kreuzdorngewächse", [103]],
    ["loranthaceae", "Loranthaceae", "Mistelgewächse", [104]],
    ["oleaceae", "Oleaceae", "Ölbaumgewächse", [105]],
    ["rubiaceae", "Rubiaceae", "Rötegewächse", [[106, 108]]],
    ["caprifoliaceae", "Caprifoliaceae", "Geißblattgewächse", [[109, 110]]],
    ["convolvulaceae", "Convolvulaceae", "Windengewächse", [111]],
    ["boraginaceae", "Boraginaceae", "Boretschgewächse", [112]],
    ["solanaceae", "Solanaceae", "Nachtschattengewächse", [113]],
    ["scrophulariaceae", "Scrophulariaceae", "Braunwurzgewächse", [114]],
    ["orobanchaceae", "Orobanchaceae", "Sommerwurzgewächse", [115]],
    ["plantaginaceae", "Plantaginaceae", "Wegerichgewächse", [[116, 119]]],
    ["lamiaceae", "Lamiaceae", "Lippenblütengewächse", [[120, 127]]],
    ["campanulaceae", "Campanulaceae", "Glockenblumengewächse", [[128, 129]]],
    ["asteraceae", "Asteraceae", "Korbblütengewächse", [[130, 155]]],
    ["potamogetonaceae", "Potamogetonaceae", "Laichkrautgewächse", [[156, 157]]],
    ["liliaceae", "Liliaceae", "Liliengewächse", [[158, 160]]],
    ["iridaceae", "Iridaceae", "Schwertliliengewächse", [161]],
    ["juncaceae", "Juncaceae", "Binsengewächse", [[162, 165]]],
    ["cyperaceae", "Cyperaceae", "Sauergräser", [[166, 172]]],
    ["poaceae", "Poaceae", "Süßgräser", [[173, 198]]],
    ["lemnaceae", "Lemnaceae", "Wasserlinsengewächse", [199]],
    ["typhaceae", "Typhaceae", "Rohrkolbengewächse", [[200, 201]]]
  ]),
  animal: makeTaxonomy("animal", [
    ["lepidoptera", "Lepidoptera", "Schmetterlinge", [[0, 13]]],
    ["anguilliformes", "Anguilliformes", "Aalartige", [14]],
    ["esociformes", "Esociformes", "Hechtartige", [15]],
    ["cypriniformes", "Cypriniformes", "Karpfenartige", [16, [20, 25]]],
    ["salmoniformes", "Salmoniformes", "Lachsartige", [[17, 18]]],
    ["gasterosteiformes", "Gasterosteiformes", "Stichlingsartige", [19]],
    ["anura", "Anura", "Froschlurche", [[26, 30]]],
    ["urodela", "Urodela", "Schwanzlurche", [[31, 33]]],
    ["squamata", "Squamata", "Schuppenkriechtiere", [[34, 39]]],
    ["podicipediformes", "Podicipediformes", "Lappentaucher", [[40, 41]]],
    ["pelecaniformes", "Pelecaniformes", "Ruderfüßer", [42]],
    ["ciconiiformes", "Ciconiiformes", "Schreitvögel", [[43, 47]]],
    ["anseriformes", "Anseriformes", "Entenvögel", [[48, 59]]],
    ["accipitriformes", "Accipitriformes", "Greifvögel", [[60, 68]]],
    ["galliformes", "Galliformes", "Hühnervögel", [[69, 70]]],
    ["gruiformes", "Gruiformes", "Kranichvögel", [[71, 74]]],
    ["charadriiformes", "Charadriiformes", "Wat- und Möwenvögel", [[75, 77]]],
    ["columbiformes", "Columbiformes", "Tauben", [[78, 79]]],
    ["cuculiformes", "Cuculiformes", "Kuckucke", [80]],
    ["strigiformes", "Strigiformes", "Eulen", [[81, 84]]],
    ["apodiformes", "Apodiformes", "Segler", [85]],
    ["coraciiformes", "Coraciiformes", "Rackenvögel", [86]],
    ["piciformes", "Piciformes", "Spechtvögel", [[87, 89]]],
    ["passeriformes", "Passeriformes", "Singvögel", [[90, 129]]],
    ["insectivora", "Insectivora", "Insektenfresser", [[130, 131]]],
    ["lagomorpha", "Lagomorpha", "Hasentiere", [[132, 133]]],
    ["rodentia", "Rodentia", "Nagetiere", [[134, 137]]],
    ["carnivora", "Carnivora", "Raubtiere", [[138, 145]]],
    ["artiodactyla", "Artiodactyla", "Paarhufer", [[146, 150]]]
  ])
};

const TAXONOMY_BY_ID = Object.fromEntries(Object.values(TAXON_FILTERS).flat().flatMap(taxon =>
  taxon.ids.map(id => [`${taxon.group}-${id}`, taxon])
));

const BIRD_ORDER_KEYS = new Set([
  "podicipediformes", "pelecaniformes", "ciconiiformes", "anseriformes", "accipitriformes",
  "galliformes", "gruiformes", "charadriiformes", "columbiformes", "cuculiformes",
  "strigiformes", "apodiformes", "coraciiformes", "piciformes", "passeriformes"
]);

function isBirdSpecies(item) {
  return item?.kind === "species" && item.group === "animal" && BIRD_ORDER_KEYS.has(TAXONOMY_BY_ID[item.id]?.key);
}

// these need structure shots, not just a pretty overview
const DIAGNOSTIC_FOCUS = {
  equisetaceae: "Zuerst Verzweigung, Scheidenzähne und Sporenähre prüfen.",
  dennstaedtiaceae: "Zuerst Wedelaufbau, Fiederform und Sporenlager prüfen.",
  woodsiaceae: "Zuerst Wedelteilung, Fiederform und Sori auf der Unterseite prüfen.",
  dryopteridaceae: "Zuerst Wedelteilung, Fiederzähne, Sori und Stielschuppen prüfen.",
  juncaceae: "Zuerst Stängelquerschnitt, Blattbehaarung und Blütenstand prüfen.",
  cyperaceae: "Zuerst Stängelquerschnitt, Blattstellung, Ähren und Schläuche prüfen.",
  poaceae: "Zuerst Blütenstand, Blatthäutchen, Blattöhrchen, Scheide und Behaarung prüfen."
};

function diagnosticFocus(species) {
  return DIAGNOSTIC_FOCUS[TAXONOMY_BY_ID[species.id]?.key] || "";
}
