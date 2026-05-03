-- Demo seed: 6 iconic spots so a fresh deployment isn't empty.
-- Run scripts/migrate-notion-to-supabase.js to import the full 36-spot catalog.
-- Idempotent: ON CONFLICT DO NOTHING on lower(name).

with new_spots as (
  insert into travelid.spots (
    name, category, region, country, latitude, longitude, address,
    halal, prayer_room, entry_fee, best_time_to_visit, local_tips,
    opening_hours, tags, featured, published
  ) values
    ('Borobudur Temple', 'temple', 'Borobudur', 'ID', -7.6079, 110.2038,
     'Jl. Badrawati, Borobudur, Magelang Regency, Central Java',
     true, true, 455000, 'Sunrise',
     'Foreigner ticket IDR 455k (Indonesian residents IDR 50k — bring KTP/KITAS). Sunrise tour from Manohara Resort IDR 750k.',
     '06:00 – 17:00 daily',
     array['unesco','photogenic','family-friendly'], true, true),

    ('Tanah Lot Temple', 'temple', 'Bali', 'ID', -8.6212, 115.0868,
     'Beraban, Kediri, Tabanan Regency, Bali',
     false, true, 75000, 'Sunset',
     'Arrive 1.5h before sunset for parking. Sarong required (provided free at entrance).',
     '07:00 – 19:00 daily',
     array['photogenic','romantic','instagram-spot'], true, true),

    ('Mount Bromo Sunrise', 'volcano', 'Bromo', 'ID', -7.9425, 112.953,
     'Bromo Tengger Semeru National Park, Probolinggo Regency, East Java',
     true, true, 220000, 'Sunrise',
     'Stay overnight in Cemoro Lawang. Jeep tour from Probolinggo IDR 600-900k pp shared. Wear winter layers — it''s 5°C at 03:00.',
     'Jeep tours start 02:30; sunrise 05:30',
     array['adventure','photogenic','instagram-spot'], true, true),

    ('Petronas Twin Towers', 'cultural', 'Kuala Lumpur', 'MY', 3.1579, 101.7116,
     'Lower Ground (Concourse), Petronas Twin Towers, KLCC, 50088 Kuala Lumpur',
     true, true, 98, 'Sunset',
     'Skybridge+Observation deck ticket MYR 98 (foreigner), MYR 50 (Malaysian). Book at petronastwintowers.com.my 1-2 weeks ahead.',
     'Tue–Sun 09:00–20:30; closed Mondays',
     array['family-friendly','photogenic','instagram-spot'], true, true),

    ('George Town Heritage (Penang)', 'cultural', 'Penang', 'MY', 5.4144, 100.337,
     'Lebuh Armenian, George Town, 10200 George Town, Penang',
     true, true, 0, 'All Year',
     'Cheong Fatt Tze guided tour MYR 25 (3x daily). Free Heritage Trail map at Penang Tourism Office (Lebuh Pantai).',
     'Open 24h (sites mostly 10:00-18:00)',
     array['unesco','photogenic','family-friendly','instagram-spot'], true, true),

    ('Mount Kinabalu', 'volcano', 'Sabah', 'MY', 6.0753, 116.5586,
     'Kinabalu Park, Ranau, 89308 Kundasang, Sabah',
     true, true, 1500, 'Dry Season (May-Sep)',
     'Mandatory mountain guide. Climb permit + accommodation MYR 1,200-1,800 (foreigner). Book 4-6 months ahead via Sabah Parks.',
     'Climbing: 06:30 start (Day 1), summit by 04:30 (Day 2)',
     array['unesco','adventure','hidden-gem','photogenic'], true, true)
  on conflict ((lower(name))) do nothing
  returning id, name
)
insert into travelid.spot_translations (spot_id, lang, name, description)
select id, t.lang, t.name, t.description
from new_spots
join lateral (values
  ('Borobudur Temple','en','Borobudur Temple','9th-century Mahayana Buddhist monument and the world''s largest Buddhist temple. UNESCO World Heritage. Sunrise over the stupas with Mount Merapi in the distance is the iconic shot.'),
  ('Borobudur Temple','id','Candi Borobudur','Monumen Buddha Mahayana abad ke-9 dan candi Buddha terbesar di dunia. Warisan Dunia UNESCO. Sunrise di atas stupa dengan Gunung Merapi di kejauhan adalah pemandangan ikoniknya.'),
  ('Borobudur Temple','ms','Candi Borobudur','Monumen Buddha Mahayana abad ke-9 dan candi Buddha terbesar di dunia. Tapak Warisan Dunia UNESCO.'),
  ('Borobudur Temple','ko','보로부두르 사원','9세기 대승불교 기념물이자 세계 최대 불교 사원. 유네스코 세계유산. 멀리 메라피 화산을 배경으로 한 스투파 위 일출이 상징적.'),
  ('Borobudur Temple','zh','婆罗浮屠','9世纪大乘佛教遗迹,世界最大佛塔群。联合国教科文组织世界遗产。'),
  ('Borobudur Temple','ja','ボロブドゥール寺院','9世紀の大乗仏教遺跡で世界最大の仏教寺院。ユネスコ世界遺産。'),
  ('Borobudur Temple','ar','معبد بوروبودور','نصب بوذي ماهايانا من القرن التاسع وأكبر معبد بوذي في العالم. موقع تراث عالمي لليونسكو.'),

  ('Tanah Lot Temple','en','Tanah Lot Temple','Iconic Hindu sea temple perched on a rock formation off Bali''s southwest coast. Famous for sunset photography and kecak dance performances on weekends.'),
  ('Tanah Lot Temple','id','Pura Tanah Lot','Pura laut Hindu ikonik di atas batu karang di pantai barat daya Bali. Terkenal dengan foto sunset dan pertunjukan tari kecak di akhir pekan.'),
  ('Tanah Lot Temple','ms','Tokong Tanah Lot','Tokong laut Hindu ikonik di atas batu karang di pantai barat daya Bali.'),
  ('Tanah Lot Temple','ko','타나롯 사원','발리 남서쪽 해안 바위 위에 있는 힌두 사원. 일몰 사진과 주말 케착 댄스 공연으로 유명합니다.'),
  ('Tanah Lot Temple','zh','海神庙(塔纳罗特)','位于巴厘岛西南海岸礁石上的标志性印度教海神庙。'),
  ('Tanah Lot Temple','ja','タナロット寺院','バリ島南西海岸の岩上にある象徴的なヒンドゥー海神寺院。'),
  ('Tanah Lot Temple','ar','معبد تاناه لوت','معبد هندوسي بحري رمزي على صخرة قبالة الساحل الجنوبي الغربي لبالي.'),

  ('Mount Bromo Sunrise','en','Mount Bromo Sunrise','Active volcano in Tengger Caldera, East Java. Pre-dawn jeep convoy to Penanjakan viewpoint for sunrise over a sea of clouds, then walk across the Sea of Sand to the smoking crater rim.'),
  ('Mount Bromo Sunrise','id','Sunrise Gunung Bromo','Gunung berapi aktif di Kaldera Tengger, Jawa Timur. Konvoi jip dini hari ke Penanjakan untuk sunrise di atas lautan awan.'),
  ('Mount Bromo Sunrise','ms','Sunrise Gunung Bromo','Gunung berapi aktif di Kaldera Tengger, Jawa Timur. Konvoi jip dini hari ke Penanjakan untuk matahari terbit di atas lautan awan.'),
  ('Mount Bromo Sunrise','ko','브로모 화산 일출','동자바 텡거르 칼데라의 활화산. 새벽 제프 행렬로 페나냩잔 전망대에서 구름바다 위 일출.'),
  ('Mount Bromo Sunrise','zh','布罗莫火山日出','东爪哇腾格火山口内的活火山。黎明前吉普车队上小小泰尔台看云海上日出。'),
  ('Mount Bromo Sunrise','ja','ブロモ山サンライズ','東ジャワ・テンゲル・カルデラ内の活火山。夜明け前のジープツアーでペナンジャカン展望台へ。'),
  ('Mount Bromo Sunrise','ar','شروق جبل برومو','بركان نشط في كالديرا تنغر بشرق جاوة. قافلة جيب قبل الفجر إلى نقطة بيناجاكان لمشاهدة الشروق فوق بحر السحب.'),

  ('Petronas Twin Towers','en','Petronas Twin Towers','452m twin skyscrapers, KL''s icon. Skybridge on level 41 (170m) and observation deck on 86 (370m); book online to skip queues. Suria KLCC mall + KLCC Park + symphony fountain at the base.'),
  ('Petronas Twin Towers','id','Menara Berkembar Petronas','Menara kembar 452m, ikon KL. Skybridge di lantai 41 (170m) dan dek observasi di lantai 86 (370m).'),
  ('Petronas Twin Towers','ms','Menara Berkembar Petronas','Menara kembar setinggi 452m, ikon KL. Skybridge di tingkat 41 (170m) dan dek pemerhatian di tingkat 86 (370m); tempah dalam talian untuk elak beratur.'),
  ('Petronas Twin Towers','ko','페트로나스 트윈 타워','452m 쌍둥이 초고층, 쿠알라룸푸르의 아이콘. 41층 스카이브릿지(170m), 86층 전망대(370m).'),
  ('Petronas Twin Towers','zh','双子塔','452米双子摩天大楼,吉隆坡地标。空中走廊位于41楼(170m),观景台位于86楼(370m)。'),
  ('Petronas Twin Towers','ja','ペトロナス・ツインタワー','452mの双子超高層ビル。KLのシンボル。41階のスカイブリッジ(170m)、86階の展望デッキ(370m)。'),
  ('Petronas Twin Towers','ar','أبراج بتروناس التوأم','برجان توأمان بارتفاع 452 متر، رمز كوالالمبور. جسر السماء في الطابق 41 (170م) ومنصة المراقبة في الطابق 86 (370م).'),

  ('George Town Heritage (Penang)','en','George Town Heritage (Penang)','UNESCO-listed colonial trading port. Cheong Fatt Tze (Blue Mansion), Khoo Kongsi clan house, Ernest Zacharevic street art murals, Armenian Street, hawker food at Lebuh Chulia.'),
  ('George Town Heritage (Penang)','id','Pusaka George Town (Penang)','Pelabuhan dagang kolonial warisan UNESCO. Cheong Fatt Tze, Khoo Kongsi, mural seni jalanan Ernest Zacharevic, Armenian Street.'),
  ('George Town Heritage (Penang)','ms','Warisan George Town (Pulau Pinang)','Pelabuhan dagang kolonial warisan UNESCO. Cheong Fatt Tze (Blue Mansion), rumah persatuan Khoo Kongsi, mural seni jalanan Ernest Zacharevic.'),
  ('George Town Heritage (Penang)','ko','조지타운 유산 (페낭)','유네스코 유산 식민지 무역 항. 청팟츠(Blue Mansion), 쿠 공사 씨족 지회, 어니스트 자차레빅 거리 예술.'),
  ('George Town Heritage (Penang)','zh','乔治市古迹 (槟城)','世界遗产殖民商港。蓝屋(Blue Mansion)、邱公司、Ernest Zacharevic街头壁画。'),
  ('George Town Heritage (Penang)','ja','ジョージタウン世界遺産 (ペナン)','ユネスコ世界遺産の植民地貿易港。チョン・ファット・ツェー邸、クーコンシー一族集会所、ストリートアート。'),
  ('George Town Heritage (Penang)','ar','تراث جورج تاون (بينانغ)','ميناء تجاري استعماري على قائمة اليونسكو. قصر تشونغ فات تسي (البيت الأزرق)، بيت عشيرة كو كونغسي، جداريات إيرنست زاتشريفيتش.'),

  ('Mount Kinabalu','en','Mount Kinabalu','Sabah''s 4,095m granite peak — Borneo''s highest mountain and a UNESCO World Heritage site. The 2-day Summit Trail is non-technical but tough.'),
  ('Mount Kinabalu','id','Gunung Kinabalu','Puncak granit setinggi 4.095m di Sabah — gunung tertinggi Borneo dan Warisan Dunia UNESCO.'),
  ('Mount Kinabalu','ms','Gunung Kinabalu','Puncak granit setinggi 4,095m di Sabah — gunung tertinggi Borneo dan Tapak Warisan Dunia UNESCO. Laluan Puncak 2 hari tidak teknikal tapi mencabar.'),
  ('Mount Kinabalu','ko','키나발루 산','사바의 4,095m 화강암 봉 — 보르네오 최고봉이자 유네스코 세계유산.'),
  ('Mount Kinabalu','zh','京那巴鲁山','沙巴4,095米花岗岩山峰 — 婆罗洲最高峰与联合国教科文组织世界遗产。'),
  ('Mount Kinabalu','ja','キナバル山','サバ州の4,095mの花崗岩山頂、ボルネオ最高峰でユネスコ世界遺産。'),
  ('Mount Kinabalu','ar','جبل كينابالو','قمة جبلية من الجرانيت في صباح بارتفاع 4,095 متر — أعلى جبل في بورنيو وموقع تراث عالمي لليونسكو.')
) as t(spot_name, lang, name, description) on t.spot_name = new_spots.name
on conflict (spot_id, lang) do nothing;
