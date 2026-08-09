import LEGACY_ITINERARY from './itinerary.json' with { type: 'json' };
import { parseMoney } from './utils.js';

const activity = (date, id, time, city, title, location, cost = 0, type = 'Visita', extra = {}) => ({
  date, id, time, city, title, location, cost, type, ...extra
});

export const DEFAULT_FLIGHTS = [
  { id: 'flight-1', date: '2026-08-21', from: 'Santiago', fromCode: 'SCL', to: 'Los Ángeles', toCode: 'LAX', airline: 'LATAM Airlines', flight: 'LA602', time: '23:25' },
  { id: 'flight-2', date: '2026-08-23', from: 'Los Ángeles', fromCode: 'LAX', to: 'Shanghái', toCode: 'PVG', airline: 'Delta Air Lines', flight: 'DL39', time: '11:45' },
  { id: 'flight-3', date: '2026-08-31', from: 'Shanghái', fromCode: 'PVG', to: 'Tokio-Haneda', toCode: 'HND', airline: 'All Nippon Airways', flight: 'NH968', time: '01:50' },
  { id: 'flight-4', date: '2026-08-31', from: 'Tokio-Haneda', fromCode: 'HND', to: 'Komatsu', toCode: 'KMQ', airline: 'Japan Airlines', flight: 'JL185', time: '09:20' },
  { id: 'flight-5', date: '2026-09-10', from: 'Tokio-Haneda', fromCode: 'HND', to: 'Los Ángeles', toCode: 'LAX', airline: 'Delta Air Lines', flight: 'DL8', time: '16:35' },
  { id: 'flight-6', date: '2026-09-10', from: 'Los Ángeles', fromCode: 'LAX', to: 'Santiago', toCode: 'SCL', airline: 'LATAM Airlines', flight: 'LA603', time: '14:55', needsCheck: true }
];

export const DEFAULT_STAYS = [
  { id: 'stay-1', country: 'China', city: 'SHANGHAI', checkIn: '2026-08-24T17:40', checkOut: '2026-08-28T08:00', nights: 4, estTotal: 250000, defaultLocation: "People's Square" },
  { id: 'stay-2', country: 'China', city: 'HANGZHOU', checkIn: '2026-08-28T11:00', checkOut: '2026-08-30T07:00', nights: 2, estTotal: 150000, defaultLocation: 'Longxiangqiao Metro Station' },
  { id: 'stay-3', country: 'China', city: 'SUZHOU', checkIn: '2026-08-30T09:00', checkOut: '2026-08-30T19:00', nights: 0, estTotal: 0, defaultLocation: 'Paseo de día' },
  { id: 'stay-4', country: 'China', city: 'SHANGHAI', checkIn: '2026-08-30T21:00', checkOut: '2026-08-31T00:15', nights: 1, estTotal: 50000, defaultLocation: 'Aeropuerto PVG' },
  { id: 'stay-5', country: 'Japón', city: 'KANAZAWA', checkIn: '2026-08-31T17:00', checkOut: '2026-09-02T08:00', nights: 2, estTotal: 100000, defaultLocation: 'Cerca de las atracciones' },
  { id: 'stay-6', country: 'Japón', city: 'TAKAYAMA', checkIn: '2026-09-02T19:00', checkOut: '2026-09-03T16:00', nights: 1, estTotal: 100000, defaultLocation: 'Centro histórico' },
  { id: 'stay-7', country: 'Japón', city: 'MATSUMOTO', checkIn: '2026-09-03T20:00', checkOut: '2026-09-04T17:00', nights: 1, estTotal: 75000, defaultLocation: 'Estación de Matsumoto' },
  { id: 'stay-8', country: 'Japón', city: 'KAWAGUCHIKO', checkIn: '2026-09-04T21:00', checkOut: '2026-09-06T12:00', nights: 2, estTotal: 250000, defaultLocation: 'Lago Kawaguchi' },
  { id: 'stay-9', country: 'Japón', city: 'TOKYO', checkIn: '2026-09-06T15:00', checkOut: '2026-09-10T12:00', nights: 4, estTotal: 300000, defaultLocation: 'Tokio centro' }
].map(stay => ({ ...stay, estPerPerson: Math.round(stay.estTotal / 2) }));

const CURATED_ACTIVITIES = /* @__PURE__ */ (() => [
  activity('2026-08-21','flight-it-1','23:25','SANTIAGO','Vuelo LA602 a Los Ángeles','Aeropuerto Arturo Merino Benítez',0,'Vuelo',{flightId:'flight-1'}),
  activity('2026-08-23','flight-it-2','11:45','LOS ANGELES','Vuelo DL39 a Shanghái','Los Angeles International Airport',0,'Vuelo',{flightId:'flight-2'}),
  activity('2026-08-24','24-1','17:40','SHANGHAI','Llegada al aeropuerto PVG','Aeropuerto Pudong',0,'Vuelo'),
  activity('2026-08-24','24-2','20:00','SHANGHAI','Paseo nocturno por el malecón','The Bund',0,'Visita'),
  activity('2026-08-24','24-3','20:45','SHANGHAI','Cruce del río en ferry','Ferry The Bund',260,'Transporte'),
  activity('2026-08-24','24-4','21:00','SHANGHAI','Paseo por el distrito financiero','Lujiazui',0,'Visita'),
  activity('2026-08-24','24-5','22:00','SHANGHAI','Cena','Din Tai Fung',25000,'Comida'),
  activity('2026-08-25','25-1','08:30','SHANGHAI','Visita al jardín clásico','Yuyuan Garden',5200,'Visita'),
  activity('2026-08-25','25-2','10:30','SHANGHAI','Templo taoísta','City God Temple',1300,'Visita'),
  activity('2026-08-25','25-3','11:15','SHANGHAI','Casco antiguo y bazar','Yuyuan Bazaar',0,'Visita'),
  activity('2026-08-25','25-4','12:45','SHANGHAI','Almuerzo de xiaolongbao','Nanxiang',12000,'Comida'),
  activity('2026-08-25','25-5','14:30','SHANGHAI','Museo de Shanghái','Shanghai Museum',0,'Visita'),
  activity('2026-08-25','25-6','16:30','SHANGHAI',"People's Square","People's Square",0,'Visita'),
  activity('2026-08-25','25-7','17:15','SHANGHAI','Calle comercial','Nanjing Road',0,'Compras'),
  activity('2026-08-25','25-8','19:00','SHANGHAI','Atardecer del skyline','The Bund',0,'Visita'),
  activity('2026-08-25','25-9','20:00','SHANGHAI','Cena','Jia Jia Tang Bao',20000,'Comida'),
  activity('2026-08-26','26-1','09:00','SHANGHAI','Distrito financiero','Lujiazui',0,'Visita'),
  activity('2026-08-26','26-2','09:30','SHANGHAI','Mirador de Shanghai Tower','Shanghai Tower',23400,'Visita'),
  activity('2026-08-26','26-3','11:30','SHANGHAI','Paseo entre rascacielos','Jin Mao Tower',0,'Visita'),
  activity('2026-08-26','26-4','12:00','SHANGHAI','Apple Store Pudong','Apple Store Pudong',0,'Compras'),
  activity('2026-08-26','26-5','13:00','SHANGHAI','Almuerzo','IFC Mall',18000,'Comida'),
  activity('2026-08-26','26-6','14:30','SHANGHAI','Museo de Astronomía','Shanghai Astronomy Museum',3900,'Visita'),
  activity('2026-08-26','26-7','17:00','SHANGHAI','Paseo junto al río','Riverside Promenade',0,'Visita'),
  activity('2026-08-26','26-8','19:30','SHANGHAI','Cena hot pot','Haidilao',28000,'Comida'),
  activity('2026-08-26','26-9','21:00','SHANGHAI','Rooftop panorámico','Flair / POP Bar',20000,'Comida'),
  activity('2026-08-27','27-1','08:30','SHANGHAI','Jade Buddha Temple','Jade Buddha Temple',2600,'Visita'),
  activity('2026-08-27','27-2','10:30','SHANGHAI','Distrito de arte contemporáneo','M50 Creative Park',0,'Visita'),
  activity('2026-08-27','27-3','12:00','SHANGHAI','Paseo por Suzhou Creek','Suzhou Creek',0,'Visita'),
  activity('2026-08-27','27-4','13:00','SHANGHAI','Almuerzo','Cafés de Suzhou Creek',15000,'Comida'),
  activity('2026-08-27','27-5','14:30','SHANGHAI','Recorrido por Rockbund','Rockbund',0,'Visita'),
  activity('2026-08-27','27-6','16:30','SHANGHAI','Paseo por North Bund','North Bund',0,'Visita'),
  activity('2026-08-27','27-7','19:30','SHANGHAI','Cena de alta gastronomía','Hakkasan',60000,'Comida'),
  activity('2026-08-28','28-1','08:30','SHANGHAI','Longhua Temple','Longhua Temple',2600,'Visita'),
  activity('2026-08-28','28-2','10:30','SHANGHAI','Tren a Hangzhou','Shanghai Hongqiao Station',20000,'Transporte',{from:'Shanghai Hongqiao',to:'Hangzhou East'}),
  activity('2026-08-28','28-3','12:30','HANGZHOU','Llegada y hotel','Hangzhou East Station',0,'Transporte'),
  activity('2026-08-28','28-4','14:30','HANGZHOU','Paseo por el lago','West Lake',0,'Visita'),
  activity('2026-08-28','28-5','15:30','HANGZHOU','Barco tradicional','West Lake Cruise',8000,'Visita'),
  activity('2026-08-28','28-6','17:00','HANGZHOU','Pagoda histórica','Leifeng Pagoda',7000,'Visita'),
  activity('2026-08-28','28-8','20:00','HANGZHOU','Cena de gastronomía local','Hubin / Lakeside',20000,'Comida'),
  activity('2026-08-29','29-1','08:30','HANGZHOU','Templo budista Lingyin','Lingyin Temple',9000,'Visita'),
  activity('2026-08-29','29-2','10:30','HANGZHOU','Formaciones rocosas','Feilai Peak',9000,'Visita'),
  activity('2026-08-29','29-3','12:30','HANGZHOU','Almuerzo tradicional','Restaurante local',15000,'Comida'),
  activity('2026-08-29','29-4','14:00','HANGZHOU','Plantaciones de té verde','Longjing Village',0,'Visita'),
  activity('2026-08-29','29-5','15:00','HANGZHOU','Degustación de té Longjing','Casa de té',6000,'Comida'),
  activity('2026-08-29','29-7','18:00','HANGZHOU','Calle histórica','Hefang Street',0,'Compras'),
  activity('2026-08-30','30-1','06:30','HANGZHOU','Check-out del hotel','Hotel',0,'Estadía'),
  activity('2026-08-30','30-3','09:00','SUZHOU','Llegada desde Hangzhou','Suzhou Station',30000,'Transporte',{from:'Hangzhou East',to:'Suzhou'}),
  activity('2026-08-30','30-4','09:30','SUZHOU','Jardín clásico',"Humble Administrator's Garden",7000,'Visita'),
  activity('2026-08-30','30-5','11:15','SUZHOU','Paseo por calle histórica','Pingjiang Road',0,'Visita'),
  activity('2026-08-30','30-6','12:30','SUZHOU','Almuerzo local','Pingjiang Road',15000,'Comida'),
  activity('2026-08-30','30-8','15:15','SUZHOU','Zona de canales','Shantang Street',0,'Visita'),
  activity('2026-08-30','30-9','16:30','SUZHOU','Paseo en barco','Canal Boat',7000,'Visita'),
  activity('2026-08-30','30-10','17:30','SUZHOU','Tren a Shanghái','Suzhou Station',20000,'Transporte',{from:'Suzhou',to:'Shanghai Hongqiao'}),
  activity('2026-08-30','30-12','19:00','SHANGHAI','Traslado y check-in','Hotel PVG',18000,'Estadía'),
  activity('2026-08-31','flight-it-3','01:50','SHANGHAI','Vuelo NH968 a Tokio-Haneda','Shanghai Pudong Airport',0,'Vuelo',{flightId:'flight-3'}),
  activity('2026-08-31','flight-it-4','09:20','TOKYO','Vuelo JL185 a Komatsu','Tokyo Haneda Airport',0,'Vuelo',{flightId:'flight-4'}),
  activity('2026-08-31','31-5','16:30','KANAZAWA','Traslado a Kanazawa','Bus Limousine',0,'Transporte'),
  activity('2026-08-31','31-7','19:00','KANAZAWA','Cena','Estación Kanazawa',20000,'Comida'),
  activity('2026-09-01','01-1','08:30','KANAZAWA','Jardín Kenroku-en','Kenroku-en',2000,'Visita'),
  activity('2026-09-01','01-2','10:30','KANAZAWA','Castillo Kanazawa','Castle Park',0,'Visita'),
  activity('2026-09-01','01-3','12:30','KANAZAWA','Almuerzo en mercado','Mercado Omicho',18000,'Comida'),
  activity('2026-09-01','01-4','14:00','KANAZAWA','Museo de Arte S. XXI','21st Century Museum',3500,'Visita'),
  activity('2026-09-01','01-7','17:30','KANAZAWA','Festival Kaze no Bon','Yatsuo',0,'Visita'),
  activity('2026-09-02','02-1','08:00','KANAZAWA','Check-out y salida','Nohi Bus Center',0,'Estadía'),
  activity('2026-09-02','02-2','10:00','TAKAYAMA','Bus a Shirakawa-go','Shirakawa-go',20295,'Transporte',{from:'Kanazawa',to:'Shirakawa-go'}),
  activity('2026-09-02','02-4','14:00','TAKAYAMA','Bus a Takayama','Shirakawa-go',15785,'Transporte',{from:'Shirakawa-go',to:'Takayama'}),
  activity('2026-09-02','02-6','16:00','TAKAYAMA','Paseo por Sanmachi Suji','Casco histórico',0,'Visita'),
  activity('2026-09-02','02-7','19:00','TAKAYAMA','Cena de carne Hida','Takayama',25000,'Comida'),
  activity('2026-09-03','03-1','08:00','TAKAYAMA','Mercado Miyagawa','Morning Market',0,'Compras'),
  activity('2026-09-03','03-2','09:30','TAKAYAMA','Takayama Jinya','Takayama Jinya',3000,'Visita'),
  activity('2026-09-03','03-5','14:00','TAKAYAMA','Baño termal onsen','Green Hotel',8000,'Estadía'),
  activity('2026-09-03','03-6','16:30','MATSUMOTO','Traslado a Matsumoto','JR Hida / Nohi Bus',30000,'Transporte',{from:'Takayama',to:'Matsumoto'}),
  activity('2026-09-04','04-1','08:30','MATSUMOTO','Castillo Matsumoto','Matsumoto Castle',4000,'Visita'),
  activity('2026-09-04','04-2','10:30','MATSUMOTO','Nawate-dori','Nawate Street',0,'Visita'),
  activity('2026-09-04','04-4','12:30','MATSUMOTO','Almuerzo','Matsumoto',18000,'Comida'),
  activity('2026-09-04','04-5','14:00','KAWAGUCHIKO','Traslado a Kawaguchiko','Bus / JR Fujikyuko',30000,'Transporte',{from:'Matsumoto',to:'Kawaguchiko'}),
  activity('2026-09-04','04-7','18:30','KAWAGUCHIKO','Atardecer','Lago Kawaguchi',0,'Visita'),
  activity('2026-09-05','05-1','07:30','KAWAGUCHIKO','Chureito Pagoda','Arakurayama',0,'Visita'),
  activity('2026-09-05','05-2','10:00','KAWAGUCHIKO','Oishi Park','Lago Kawaguchi',0,'Visita'),
  activity('2026-09-05','05-3','11:30','KAWAGUCHIKO','Museo de Música','Music Forest',12000,'Visita'),
  activity('2026-09-05','05-5','15:00','KAWAGUCHIKO','Teleférico del monte Fuji','Ropeway',6000,'Visita'),
  activity('2026-09-06','06-1','09:00','TOKYO','Traslado a Tokio','Fujikyuko / Bus',15000,'Transporte',{from:'Kawaguchiko',to:'Tokyo'}),
  activity('2026-09-06','06-3','14:00','TOKYO','Jardines del Palacio','East Gardens',0,'Visita'),
  activity('2026-09-06','06-4','16:00','TOKYO','Marunouchi','Marunouchi',0,'Visita'),
  activity('2026-09-06','06-5','18:00','TOKYO','Cóctel con vista panorámica','Sky Gallery',20000,'Comida'),
  activity('2026-09-07','07-1','09:30','TOKYO','Ropa','UNIQLO Ginza',0,'Compras'),
  activity('2026-09-07','07-2','10:45','TOKYO','Ropa','GU Ginza',0,'Compras'),
  activity('2026-09-07','07-3','11:30','TOKYO','Hogar y papelería','MUJI Ginza',0,'Compras'),
  activity('2026-09-07','07-6','14:30','TOKYO','Recuerdos','Loft Ginza',0,'Compras'),
  activity('2026-09-07','07-9','19:00','TOKYO','Organizar equipaje','Hotel Shimbashi',0,'Estadía'),
  activity('2026-09-08','08-1','09:30','TOKYO','Kagurazaka','Kagurazaka',0,'Visita'),
  activity('2026-09-08','08-4','13:00','TOKYO','Almuerzo','Kagurazaka',18000,'Comida'),
  activity('2026-09-08','08-5','14:30','YOKOHAMA','Traslado a Yokohama','JR Line',0,'Transporte'),
  activity('2026-09-08','08-6','15:30','YOKOHAMA','Red Brick Warehouse','Minato Mirai',0,'Visita'),
  activity('2026-09-08','08-8','18:15','YOKOHAMA','Atardecer en la bahía','Minato Mirai',0,'Visita'),
  activity('2026-09-08','08-10','20:00','YOKOHAMA','Cena','Chinatown Yokohama',22000,'Comida'),
  activity('2026-09-09','09-1','09:30','TOKYO','Azabudai Hills','Azabudai Hills',0,'Visita'),
  activity('2026-09-09','09-2','11:00','TOKYO','Templo Zojo-ji','Zojo-ji',0,'Visita'),
  activity('2026-09-09','09-4','14:30','TOKYO','Tokyo City View','Roppongi',15000,'Visita'),
  activity('2026-09-09','09-6','17:45','TOKYO','Atardecer en Shibuya Sky','Shibuya Sky',18000,'Visita'),
  activity('2026-09-09','09-7','20:00','TOKYO','Cena de despedida','Shibuya',25000,'Comida'),
  activity('2026-09-10','flight-it-5','16:35','TOKYO','Vuelo DL8 a Los Ángeles','Tokyo Haneda Airport',0,'Vuelo',{flightId:'flight-5'}),
  activity('2026-09-10','flight-it-6','14:55','LOS ANGELES','Vuelo LA603 a Santiago · fecha por confirmar','Los Angeles International Airport',0,'Vuelo',{flightId:'flight-6'})
])();

const LEGACY_TYPES = { Plane: 'Vuelo', Train: 'Transporte', Camera: 'Visita', ShoppingBag: 'Compras', Utensils: 'Comida', Hotel: 'Estadía' };
const MIGRATED_ACTIVITIES = LEGACY_ITINERARY.flatMap(day => day.activities.map(item => ({
  ...item,
  date: day.date.split('/').reverse().join('-'),
  city: item.city.replaceAll('_', ' '),
  cost: parseMoney(item.cost),
  type: LEGACY_TYPES[item.type] || item.type || 'Otro',
  from: item.transportFrom,
  to: item.transportTo
})));
export const DEFAULT_ACTIVITIES = MIGRATED_ACTIVITIES.length ? MIGRATED_ACTIVITIES : CURATED_ACTIVITIES;

export const DEFAULT_STATE = {
  version: 8,
  activities: DEFAULT_ACTIVITIES,
  stays: DEFAULT_STAYS,
  flights: DEFAULT_FLIGHTS,
  checked: {},
  details: {},
  stayDetails: {},
  transportCosts: {},
  flightDetails: {},
  extraExpenses: [],
  rates: { jpy: 6.25, cny: 130 },
  preferences: { collapsedDays: {} }
};

export const PHRASES = [
  ['Gracias', '谢谢 · Xièxie', 'ありがとう · Arigatō'],
  ['Hola', '你好 · Nǐ hǎo', 'こんにちは · Konnichiwa'],
  ['¿Cuánto cuesta?', '多少钱？· Duōshao qián?', 'いくらですか？· Ikura desu ka?'],
  ['Sin picante, por favor', '请不要辣 · Qǐng bú yào là', '辛くしないでください · Karaku shinaide kudasai'],
  ['¿Dónde está la estación?', '车站在哪里？· Chēzhàn zài nǎlǐ?', '駅はどこですか？· Eki wa doko desu ka?']
];

export const TRIP_START = '2026-08-21T23:25:00-04:00';
export const TRIP_END = '2026-09-10T23:59:00-04:00';
