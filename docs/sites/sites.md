# Sites

The catalog (`data/examples/sites.json`) holds 30 candidate sites across ten categories; twelve are in
Chile. Each site's facts carry a source URL and are shown in the app only with that source. A page per
site is written when its bake completes, with the scene list, the mined-area series, the change points
and the elevation-difference numbers, so that nothing on a site page is typed by hand.

| Site | Country | Categories |
|---|---|---|
| Chuquicamata | Chile | copper, transition to underground (2019) |
| Radomiro Tomic | Chile | copper |
| Escondida | Chile | copper |
| Collahuasi | Chile | copper |
| Los Pelambres | Chile | copper |
| Los Bronces | Chile | copper |
| Quebrada Blanca | Chile | copper |
| Centinela | Chile | copper |
| Spence | Chile | copper |
| Candelaria | Chile | copper |
| Sierra Gorda | Chile | copper |
| Salar de Atacama lithium ponds | Chile | lithium brine |
| Bingham Canyon | USA | copper |
| Morenci | USA | copper |
| Cerro Verde | Peru | copper |
| Las Bambas | Peru | copper |
| Antamina | Peru | copper, zinc |
| Grasberg | Indonesia | copper, gold, transition |
| Oyu Tolgoi | Mongolia | copper |
| Kamoa-Kakula | DR Congo | copper |
| Cobre Panama | Panama | copper, halted 2023 |
| Carajas N4 and N5 | Brazil | iron ore |
| Mount Whaleback | Australia | iron ore |
| Fimiston Super Pit | Australia | gold |
| Muruntau | Uzbekistan | gold |
| Hambach | Germany | lignite |
| Belchatow | Poland | lignite |
| Mir | Russia | diamonds, closed 2001 |
| Udachnaya | Russia | diamonds |
| Athabasca oil sands (Mildred Lake) | Canada | oil sands |

A site whose seed fails the reference-polygon check or whose imagery is unusable is dropped with the
reason recorded in the bake report; the catalog is never padded with a synthetic case.
