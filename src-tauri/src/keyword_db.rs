//! Internal master-keyword database, keyed by Shutterstock category.
//!
//! Used to top up AI-generated keywords up to the user's target count entirely
//! offline — the app NEVER sends these back to the AI, so they add no tokens and
//! no API cost. Lists are ordered by relevance; the top-up consumes from the
//! start and only adds keywords not already produced by the AI.

/// Master keyword list for a Shutterstock category. Matching is case-insensitive
/// on the exact category name. Returns an empty slice for unknown categories.
pub fn master_keywords(category: &str) -> &'static [&'static str] {
    match category.trim().to_lowercase().as_str() {
        "abstract" => ABSTRACT,
        "animals/wildlife" => ANIMALS_WILDLIFE,
        "arts" => ARTS,
        "backgrounds/textures" => BACKGROUNDS_TEXTURES,
        "beauty/fashion" => BEAUTY_FASHION,
        "buildings/landmarks" => BUILDINGS_LANDMARKS,
        "business/finance" => BUSINESS_FINANCE,
        "celebrities" => CELEBRITIES,
        "education" => EDUCATION,
        "food and drink" => FOOD_AND_DRINK,
        "healthcare/medical" => HEALTHCARE_MEDICAL,
        "holidays" => HOLIDAYS,
        "industrial" => INDUSTRIAL,
        "interiors" => INTERIORS,
        "miscellaneous" => MISCELLANEOUS,
        "nature" => NATURE,
        "objects" => OBJECTS,
        "parks/outdoor" => PARKS_OUTDOOR,
        "people" => PEOPLE,
        "religion" => RELIGION,
        "science" => SCIENCE,
        "signs/symbols" => SIGNS_SYMBOLS,
        "sports/recreation" => SPORTS_RECREATION,
        "technology" => TECHNOLOGY,
        "transportation" => TRANSPORTATION,
        "vintage" => VINTAGE,
        _ => &[],
    }
}

static ABSTRACT: &[&str] = &["abstract","background","pattern","texture","gradient","design","color","shape","geometric","digital","artistic","modern","creative","futuristic","minimal","vibrant","swirl","fractal","dynamic","fluid","glowing","motion","spiral","neon","wave","surreal","luminous","vivid","prismatic","mosaic","holographic","iridescent","psychedelic","cosmic","kaleidoscope","crystalline","translucent","radiant","hypnotic","angular","layered","distorted","dimensional","tessellated","blur","bokeh","glow","lines","form","art","elegant","decorative","template","wallpaper","backdrop","energy","stylish","innovation","concept","visualization","illustration","composition"];

static ANIMALS_WILDLIFE: &[&str] = &["animal","wildlife","pet","mammal","reptile","amphibian","insect","fauna","habitat","biodiversity","conservation","endangered","exotic","tropical","safari","zoo","marine","domestic","companion","puppy","kitten","feather","fur","paw","whisker","migration","ecosystem","cute","adorable","veterinary","rescue","cat","bird","lion","tiger","elephant","horse","butterfly","fish","wolf","bear","deer","monkey","dolphin","shark","eagle","owl","fox","rabbit","whale","snake","turtle","penguin","parrot","crocodile","cheetah","gorilla","panda","koala","kangaroo","rhino","hippo","jaguar","leopard","flamingo","octopus","squirrel","alligator","peacock","hedgehog","otter","seal","dragonfly","bee","ladybug"];

static ARTS: &[&str] = &["painting","watercolor","sketch","drawing","illustration","artwork","canvas","portrait","sculpture","calligraphy","collage","etching","mural","graffiti","doodle","brushstroke","masterpiece","impressionist","expressionist","minimalism","surrealism","realism","contemporary","acrylic","charcoal","pastel","ink","graphite","printmaking","engraving","ceramics","pottery","embroidery","batik","tapestry","origami","mandala","fresco","lithograph","conceptual","art","artist","craft","gallery","museum","brush","creativity","design","modern","abstract","culture","handmade","aesthetic","visual","poster","inspiration","composition","studio","artistic"];

static BACKGROUNDS_TEXTURES: &[&str] = &["background","texture","pattern","wooden","marble","paper","brick","concrete","fabric","leather","metal","stone","sand","grass","linen","canvas","grunge","bokeh","polished","rough","smooth","weathered","rusty","cracked","woven","striped","dotted","checkered","floral","geometric","splattered","vintage","distressed","frosted","translucent","transparent","blurred","grainy","mottled","dappled","textured","knitted","embossed","abstract","wallpaper","backdrop","gradient","surface","wood","blur","seamless","clean","minimal","decorative","colorful","neutral","white","black","blue","banner","template"];

static BEAUTY_FASHION: &[&str] = &["makeup","lipstick","mascara","eyeliner","foundation","blush","perfume","skincare","moisturizer","serum","haircut","manicure","pedicure","eyebrow","eyelash","bronzer","concealer","powder","eyeshadow","fragrance","lotion","sunscreen","toner","cleanser","gloss","primer","rouge","shimmer","glitter","elegance","luxury","radiance","glow","grooming","styling","contouring","exfoliant","sophisticated","rejuvenating","refreshing","beauty","fashion","model","cosmetic","hair","style","elegant","trendy","chic","glamour","outfit","clothing","dress","accessory","portrait","female","male","skin","salon","jewelry","cosmetics","textile","fabric","boutique","fashionable","runway","wardrobe"];

static BUILDINGS_LANDMARKS: &[&str] = &["skyscraper","cathedral","mosque","temple","bridge","castle","tower","monument","stadium","museum","library","palace","mansion","cottage","apartment","church","synagogue","pagoda","fortress","lighthouse","pyramid","amphitheater","villa","dome","archway","facade","pillar","colonnade","rotunda","minaret","steeple","spire","turret","balcony","atrium","courtyard","parapet","portico","battlement","citadel","architecture","building","landmark","house","home","city","skyline","roof","window","door","office","hotel","resort","exterior","urban","structure","property","construction","residential","commercial","infrastructure","development","downtown","historic","contemporary"];

static BUSINESS_FINANCE: &[&str] = &["money","finance","investment","banking","economy","profit","revenue","budget","currency","stock","market","trade","growth","success","corporate","strategy","management","leadership","startup","meeting","conference","negotiation","presentation","accounting","audit","dividend","portfolio","equity","capital","mortgage","insurance","retirement","pension","transaction","commerce","industry","productivity","innovation","collaboration","entrepreneur","business","bank","office","company","team","teamwork","marketing","sales","chart","graph","report","analytics","laptop","contract","client","coworking","dashboard","communication","networking","consulting","target","goal"];

static CELEBRITIES: &[&str] = &["celebrity","fame","star","performer","entertainer","actor","actress","singer","musician","athlete","model","influencer","icon","legend","spotlight","glamour","premiere","awards","gala","concert","autograph","interview","endorsement","charisma","popularity","recognition","stardom","paparazzi","fans","applause","ovation","triumph","victory","championship","accomplishment","achievement","accolade","dazzling","spectacular","remarkable","famous","media","public","vip","entertainment","event"];

static EDUCATION: &[&str] = &["school","classroom","student","teacher","book","library","diploma","graduation","university","college","learning","knowledge","pencil","notebook","blackboard","curriculum","lecture","exam","homework","textbook","dictionary","calculator","microscope","globe","literacy","scholarship","academy","kindergarten","research","thesis","tutoring","mentoring","workshop","seminar","alphabet","mathematics","science","history","geography","philosophy","education","study","reading","writing","course","tutorial","lesson","training","academic","certification","skills"];

static FOOD_AND_DRINK: &[&str] = &["food","coffee","pizza","burger","salad","fruit","vegetable","dessert","cake","cocktail","sushi","pasta","bread","cheese","chocolate","smoothie","juice","tea","soup","steak","salmon","avocado","strawberry","lemon","tomato","mushroom","carrot","broccoli","mango","croissant","waffle","pancake","donut","muffin","cupcake","brownie","sandwich","taco","ramen","curry","risotto","popcorn","pretzel","bagel","macaron","hummus","kebab","tiramisu","espresso","drink","beverage","meal","breakfast","lunch","dinner","snack","kitchen","restaurant","cafe","cooking","recipe","plate","cup","ingredient","nutrition","healthy","organic","vegan","vegetarian","gourmet","delicious","freshness","culinary","dining"];

static HEALTHCARE_MEDICAL: &[&str] = &["doctor","hospital","medicine","nurse","health","pharmacy","surgery","diagnosis","prescription","treatment","vaccine","anatomy","stethoscope","thermometer","syringe","tablet","capsule","bandage","wheelchair","ambulance","dentist","therapy","wellness","nutrition","meditation","rehabilitation","psychology","cardiology","neurology","pediatrics","dermatology","ophthalmology","immunology","pathology","radiology","ultrasound","examination","laboratory","quarantine","prevention","healthcare","medical","patient","clinic","care","emergency","vaccination","symptom","recovery","hygiene","disease","virus","bacteria","biotechnology","genetics","telemedicine","consultation","immunity"];

static HOLIDAYS: &[&str] = &["thanksgiving","diwali","hanukkah","ramadan","celebration","decoration","ornament","garland","candle","lantern","pumpkin","turkey","confetti","balloon","parade","festival","ceremony","festive","tassel","stocking","mistletoe","cupid","menorah","bunny","streamer","carnival","costume","tradition","bonfire","holiday","party","wedding","gift","cheers","family","love","romance","winter","snow","greeting","invitation","surprise","seasonal"];

static INDUSTRIAL: &[&str] = &["factory","machinery","manufacturing","construction","engineering","welding","pipeline","refinery","turbine","generator","conveyor","excavator","bulldozer","crane","scaffold","workshop","warehouse","forge","furnace","hydraulic","pneumatic","automation","robotics","metallurgy","petroleum","mining","drilling","processing","smelting","casting","molding","stamping","grinding","assembly","production","fabrication","maintenance","inspection","logistics","industrial","industry","machine","engineer","plant","metal","steel","process","labor","equipment","safety","power","technician","mechanic","oil","gas","utility"];

static INTERIORS: &[&str] = &["bedroom","kitchen","bathroom","furniture","sofa","chair","table","lamp","curtain","carpet","ceiling","window","fireplace","wardrobe","bookshelf","mirror","cushion","rug","countertop","cabinet","drawer","desk","bed","chandelier","wallpaper","apartment","studio","balcony","corridor","staircase","terrace","patio","veranda","foyer","hallway","pantry","closet","attic","basement","penthouse","interior","room","home","house","decor","design","cozy","modern","minimal","clean","space","wall","floor","comfort","lighting","renovation","residential"];

static MISCELLANEOUS: &[&str] = &["isolated","transparent","mockup","template","concept","creative","unique","unusual","special","generic","everyday","blank","empty","variety","collection","diverse","minimal","simple","plain","arrangement","inspiration","innovation","imagination","curiosity","mystery","surprise","adventure","discovery","exploration","composition","overlay","frame","border","element","decoration","ornament","embellishment","flourish","motif","sticker","miscellaneous","random","mixed","assortment","object","item","sample","utility","basic","general","different","universal","practical","common"];

static NATURE: &[&str] = &["nature","forest","sunset","sunrise","sky","ocean","beach","sea","mountain","flower","waterfall","river","desert","meadow","autumn","tropical","jungle","rainforest","glacier","volcano","canyon","cliff","cave","spring","summer","winter","clouds","lightning","rainbow","snowflake","blossom","petal","leaf","branch","fern","moss","seashore","lakeside","hillside","woodland","wilderness","landscape","lake","tree","plant","grass","cloud","green","outdoor","scenic","ecology","ecosystem","biodiversity","conservation","earth","environment","natural","valley"];

static OBJECTS: &[&str] = &["smartphone","laptop","headphones","camera","gift","tools","stationery","candle","clock","umbrella","backpack","suitcase","glasses","watch","ring","necklace","bracelet","earring","pendant","brooch","key","lock","magnifier","compass","telescope","microphone","speaker","remote","battery","charger","book","pen","pencil","scissors","ruler","stapler","envelope","stamp","lantern","trophy","object","product","item","isolated","mockup","prop","tool","device","bottle","box","package","container","accessory","gadget","furniture","utensil","material","merchandise","display","studio","clean","branding","retail","catalog","realistic","commercial"];

static PARKS_OUTDOOR: &[&str] = &["park","garden","trail","hiking","camping","picnic","playground","bicycle","outdoor","fitness","lakeside","wilderness","trekking","climbing","kayaking","fishing","botanical","scenic","pathway","fountain","gazebo","pergola","meadow","grove","orchard","vineyard","patio","terrace","promenade","boardwalk","esplanade","waterfront","riverside","hillside","countryside","farmland","pasture","prairie","savanna","tundra","trees","grass","bench","path","walkway","nature","recreation","leisure","jogging","walking","sunlight","green","adventure","exploration","relaxation"];

static PEOPLE: &[&str] = &["people","family","woman","man","girl","boy","portrait","diversity","fitness","couple","children","elderly","smile","happiness","success","teamwork","friendship","leadership","community","celebration","lifestyle","professional","casual","student","worker","athlete","model","volunteer","tourist","traveler","entrepreneur","doctor","teacher","chef","artist","soldier","police","firefighter","farmer","engineer","scientist","person","human","child","adult","senior","group","crowd","face","candid","authentic","together","interaction","emotion","support","communication","collaboration","relationship","employee","customer","multicultural"];

static RELIGION: &[&str] = &["prayer","faith","mosque","spirituality","meditation","pilgrimage","worship","quran","pray","ritual","ceremony","blessing","holy","divine","enlightenment","fellowship","islam","preaching","heaven","pulpit","paradise","religion","spiritual","muslim","sermon","belief","peace","hope","tradition","eid","fitri","adha"];

static SCIENCE: &[&str] = &["science","dna","genetics","biology","laboratory","research","technology","space","galaxy","universe","chemistry","experiment","physics","astronomy","robotics","mathematics","ecology","geology","meteorology","oceanography","neuroscience","biochemistry","microbiology","biotechnology","nanotechnology","quantum","molecular","cellular","evolutionary","nuclear","astrophysics","cosmology","electromagnetic","gravitational","thermodynamics","optics","photonics","spectroscopy","chromatography","electromagnetism","microscopy","analysis","data","scientist","microscope","formula","test","sample","study","discovery","innovation","molecule","hypothesis","measurement","observation","precision","stem"];

static SIGNS_SYMBOLS: &[&str] = &["icon","symbol","logo","sign","emoji","arrow","flag","badge","label","seal","stamp","emblem","crest","insignia","monogram","code","signal","indicator","marker","warning","prohibition","instruction","direction","notification","alert","announcement","placard","billboard","banner","signpost","waypoint","beacon","barcode","hashtag","ampersand","asterisk","trademark","copyright","watermark","silhouette","pictogram","interface","navigation","button","menu","graphic","vector","line","outline","simple","minimal","communication","guide","glyph","infographic"];

static SPORTS_RECREATION: &[&str] = &["sports","football","soccer","basketball","swimming","running","yoga","tennis","cycling","golf","baseball","cricket","volleyball","rugby","boxing","wrestling","gymnastics","athletics","archery","fencing","rowing","sailing","surfing","skiing","snowboarding","skateboarding","climbing","diving","karate","judo","taekwondo","weightlifting","triathlon","marathon","sprinting","badminton","handball","lacrosse","polo","squash","racquetball","recreation","fitness","exercise","workout","athlete","gym","training","competition","action","energy","team","game","stadium","coach","speed","active","health","endurance","strength","championship","victory"];

static TECHNOLOGY: &[&str] = &["technology","tech","smartphone","laptop","computer","internet","software","hardware","coding","programming","cybersecurity","blockchain","cryptocurrency","robotics","automation","semiconductor","processor","networking","cloud","server","database","algorithm","analytics","interface","application","digital","electronic","wireless","broadband","satellite","microchip","nanotechnology","holographic","telecommunications","biometric","cryptography","drone","gadget","innovation","futuristic","computing","engineering","network","data","system","device","screen","future","robot","electronics","ai"];

static TRANSPORTATION: &[&str] = &["transportation","car","airplane","train","truck","boat","bicycle","motorcycle","bus","helicopter","yacht","cruise","ferry","tram","subway","scooter","skateboard","rickshaw","carriage","gondola","canoe","kayak","sailboat","speedboat","tanker","freighter","locomotive","tractor","forklift","ambulance","submarine","spacecraft","rocket","satellite","drone","glider","limousine","convertible","sedan","minibus","pickup","transport","vehicle","road","travel","traffic","airport","logistics","shipping","cargo","delivery","mobility","taxi","route","driving","parking","station","transit","highway","freight","passenger","fleet","navigation"];

static VINTAGE: &[&str] = &["vintage","retro","antique","nostalgic","classic","aged","weathered","distressed","grunge","worn","faded","rustic","traditional","historical","victorian","edwardian","baroque","renaissance","medieval","ancient","archaic","timeworn","sepia","monochrome","analog","analogue","handmade","artisanal","heritage","heirloom","relic","artifact","collectible","keepsake","memento","souvenir","obsolete","antiquated","bygone","outmoded","yellowed","old","film","timeless","historic","memory","typography"];
