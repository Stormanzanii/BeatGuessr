// Original release years, rather than the date of a later compilation/reissue.
// Format: title | artist | year | genre
const rows = `
Hey Jude|The Beatles|1968|Rock
Come Together|The Beatles|1969|Rock
Here Comes the Sun|The Beatles|1969|Rock
Paint It Black|The Rolling Stones|1966|Rock
Gimme Shelter|The Rolling Stones|1969|Rock
House of the Rising Sun|The Animals|1964|Rock
Mrs. Robinson|Simon & Garfunkel|1968|Folk
The Sound of Silence|Simon & Garfunkel|1964|Folk
Respect|Aretha Franklin|1967|R&B
Stand By Me|Ben E. King|1961|R&B
My Girl|The Temptations|1964|R&B
I Want You Back|The Jackson 5|1969|Pop
Can't Help Falling in Love|Elvis Presley|1961|Pop
Ring of Fire|Johnny Cash|1963|Country
Space Oddity|David Bowie|1969|Rock
Bohemian Rhapsody|Queen|1975|Rock
Don't Stop Me Now|Queen|1978|Rock
We Will Rock You|Queen|1977|Rock
Dreams|Fleetwood Mac|1977|Rock
Go Your Own Way|Fleetwood Mac|1976|Rock
Hotel California|Eagles|1976|Rock
Stairway to Heaven|Led Zeppelin|1971|Rock
Immigrant Song|Led Zeppelin|1970|Rock
Sweet Home Alabama|Lynyrd Skynyrd|1974|Rock
Rocket Man|Elton John|1972|Pop
Tiny Dancer|Elton John|1971|Pop
Your Song|Elton John|1970|Pop
Dancing Queen|ABBA|1976|Pop
Mamma Mia|ABBA|1975|Pop
Stayin' Alive|Bee Gees|1977|Pop
September|Earth, Wind & Fire|1978|R&B
Superstition|Stevie Wonder|1972|R&B
Let's Stay Together|Al Green|1971|R&B
Lovely Day|Bill Withers|1977|R&B
Ain't No Sunshine|Bill Withers|1971|R&B
Jolene|Dolly Parton|1973|Country
Take Me Home, Country Roads|John Denver|1971|Country
The Gambler|Kenny Rogers|1978|Country
Heart of Gold|Neil Young|1972|Folk
American Pie|Don McLean|1971|Folk
Billie Jean|Michael Jackson|1982|Pop
Beat It|Michael Jackson|1982|Pop
Thriller|Michael Jackson|1982|Pop
Take on Me|a-ha|1985|Pop
Everybody Wants to Rule the World|Tears for Fears|1985|Pop
Never Gonna Give You Up|Rick Astley|1987|Pop
Like a Prayer|Madonna|1989|Pop
Girls Just Want to Have Fun|Cyndi Lauper|1983|Pop
Sweet Dreams (Are Made of This)|Eurythmics|1983|Pop
Africa|Toto|1982|Rock
Eye of the Tiger|Survivor|1982|Rock
Livin' on a Prayer|Bon Jovi|1986|Rock
Sweet Child O' Mine|Guns N' Roses|1987|Rock
Another One Bites the Dust|Queen|1980|Rock
Under Pressure|Queen & David Bowie|1981|Rock
Don't Stop Believin'|Journey|1981|Rock
Every Breath You Take|The Police|1983|Rock
With or Without You|U2|1987|Rock
Running Up That Hill (A Deal With God)|Kate Bush|1985|Pop
Purple Rain|Prince|1984|R&B
When Doves Cry|Prince|1984|R&B
Sexual Healing|Marvin Gaye|1982|R&B
Fast Car|Tracy Chapman|1988|Folk
9 to 5|Dolly Parton|1980|Country
Straight Outta Compton|N.W.A|1988|Hip-Hop
Walk This Way|Run-D.M.C.|1986|Hip-Hop
Smells Like Teen Spirit|Nirvana|1991|Rock
Come As You Are|Nirvana|1991|Rock
Wonderwall|Oasis|1995|Rock
Don't Look Back in Anger|Oasis|1995|Rock
Creep|Radiohead|1992|Rock
Karma Police|Radiohead|1997|Rock
Losing My Religion|R.E.M.|1991|Rock
Zombie|The Cranberries|1994|Rock
Basket Case|Green Day|1994|Rock
Californication|Red Hot Chili Peppers|1999|Rock
Under the Bridge|Red Hot Chili Peppers|1991|Rock
Iris|Goo Goo Dolls|1998|Rock
Enter Sandman|Metallica|1991|Rock
Nothing Else Matters|Metallica|1991|Rock
...Baby One More Time|Britney Spears|1998|Pop
Wannabe|Spice Girls|1996|Pop
I Want It That Way|Backstreet Boys|1999|Pop
Believe|Cher|1998|Pop
My Heart Will Go On|Celine Dion|1997|Pop
No Scrubs|TLC|1999|R&B
Waterfalls|TLC|1995|R&B
Say My Name|Destiny's Child|1999|R&B
No Diggity|Blackstreet|1996|R&B
California Love|2Pac|1995|Hip-Hop
Juicy|The Notorious B.I.G.|1994|Hip-Hop
Hypnotize|The Notorious B.I.G.|1997|Hip-Hop
Gangsta's Paradise|Coolio|1995|Hip-Hop
Still D.R.E.|Dr. Dre|1999|Hip-Hop
My Name Is|Eminem|1999|Hip-Hop
Around the World|Daft Punk|1997|Electronic
Sandstorm|Darude|1999|Electronic
Insomnia|Faithless|1995|Electronic
Man! I Feel Like a Woman!|Shania Twain|1997|Country
Achy Breaky Heart|Billy Ray Cyrus|1992|Country
Mr. Brightside|The Killers|2003|Rock
Somebody Told Me|The Killers|2004|Rock
Seven Nation Army|The White Stripes|2003|Rock
In the End|Linkin Park|2000|Rock
Numb|Linkin Park|2003|Rock
Chop Suey!|System of a Down|2001|Rock
Bring Me to Life|Evanescence|2003|Rock
Boulevard of Broken Dreams|Green Day|2004|Rock
Welcome to the Black Parade|My Chemical Romance|2006|Rock
Use Somebody|Kings of Leon|2008|Rock
Sex on Fire|Kings of Leon|2008|Rock
Viva La Vida|Coldplay|2008|Pop
Yellow|Coldplay|2000|Rock
The Scientist|Coldplay|2002|Rock
Toxic|Britney Spears|2003|Pop
Poker Face|Lady Gaga|2008|Pop
Bad Romance|Lady Gaga|2009|Pop
Umbrella|Rihanna|2007|Pop
Crazy in Love|Beyoncé|2003|R&B
Single Ladies (Put a Ring on It)|Beyoncé|2008|R&B
Halo|Beyoncé|2008|R&B
Hey Ya!|Outkast|2003|Hip-Hop
Ms. Jackson|Outkast|2000|Hip-Hop
Lose Yourself|Eminem|2002|Hip-Hop
Without Me|Eminem|2002|Hip-Hop
In Da Club|50 Cent|2003|Hip-Hop
Gold Digger|Kanye West|2005|Hip-Hop
Stronger|Kanye West|2007|Hip-Hop
Empire State of Mind|Jay-Z|2009|Hip-Hop
One More Time|Daft Punk|2000|Electronic
Harder, Better, Faster, Stronger|Daft Punk|2001|Electronic
Kids|MGMT|2007|Electronic
Electric Feel|MGMT|2007|Electronic
Paper Planes|M.I.A.|2007|Hip-Hop
Crazy|Gnarls Barkley|2006|R&B
Rehab|Amy Winehouse|2006|R&B
Back to Black|Amy Winehouse|2006|R&B
Before He Cheats|Carrie Underwood|2005|Country
Love Story|Taylor Swift|2008|Country
You Belong With Me|Taylor Swift|2008|Country
Rolling in the Deep|Adele|2010|Pop
Someone Like You|Adele|2011|Pop
Hello|Adele|2015|Pop
Shake It Off|Taylor Swift|2014|Pop
Blank Space|Taylor Swift|2014|Pop
Style|Taylor Swift|2014|Pop
Cruel Summer|Taylor Swift|2019|Pop
Shape of You|Ed Sheeran|2017|Pop
Thinking out Loud|Ed Sheeran|2014|Pop
Perfect|Ed Sheeran|2017|Pop
Uptown Funk|Mark Ronson|2014|Pop
Locked out of Heaven|Bruno Mars|2012|Pop
Just the Way You Are|Bruno Mars|2010|Pop
Call Me Maybe|Carly Rae Jepsen|2011|Pop
Royals|Lorde|2013|Pop
Chandelier|Sia|2014|Pop
Titanium|David Guetta|2011|Electronic
Wake Me Up|Avicii|2013|Electronic
Levels|Avicii|2011|Electronic
Lean On|Major Lazer|2015|Electronic
Closer|The Chainsmokers|2016|Electronic
Get Lucky|Daft Punk|2013|Electronic
Starboy|The Weeknd|2016|R&B
Can't Feel My Face|The Weeknd|2015|R&B
Blinding Lights|The Weeknd|2019|Pop
bad guy|Billie Eilish|2019|Pop
everything i wanted|Billie Eilish|2019|Pop
thank u, next|Ariana Grande|2018|Pop
7 rings|Ariana Grande|2019|Pop
One Last Time|Ariana Grande|2014|Pop
Radioactive|Imagine Dragons|2012|Rock
Believer|Imagine Dragons|2017|Rock
Do I Wanna Know?|Arctic Monkeys|2013|Rock
R U Mine?|Arctic Monkeys|2012|Rock
The Less I Know the Better|Tame Impala|2015|Rock
Somebody That I Used to Know|Gotye|2011|Pop
Pumped Up Kicks|Foster the People|2010|Rock
Take Me to Church|Hozier|2013|Folk
Little Lion Man|Mumford & Sons|2009|Folk
Ho Hey|The Lumineers|2012|Folk
Riptide|Vance Joy|2013|Folk
HUMBLE.|Kendrick Lamar|2017|Hip-Hop
Alright|Kendrick Lamar|2015|Hip-Hop
SICKO MODE|Travis Scott|2018|Hip-Hop
God's Plan|Drake|2018|Hip-Hop
Hotline Bling|Drake|2015|Hip-Hop
Sunflower|Post Malone|2018|Hip-Hop
Old Town Road|Lil Nas X|2018|Hip-Hop
Tennessee Whiskey|Chris Stapleton|2015|Country
Wagon Wheel|Darius Rucker|2013|Country
Body Like a Back Road|Sam Hunt|2017|Country
Gangnam Style|PSY|2012|K-Pop
DDU-DU DDU-DU|BLACKPINK|2018|K-Pop
Kill This Love|BLACKPINK|2019|K-Pop
Boy With Luv|BTS|2019|K-Pop
Fancy|TWICE|2019|K-Pop
Don't Start Now|Dua Lipa|2019|Pop
Levitating|Dua Lipa|2020|Pop
As It Was|Harry Styles|2022|Pop
Watermelon Sugar|Harry Styles|2019|Pop
Flowers|Miley Cyrus|2023|Pop
Anti-Hero|Taylor Swift|2022|Pop
Espresso|Sabrina Carpenter|2024|Pop
Please Please Please|Sabrina Carpenter|2024|Pop
good 4 u|Olivia Rodrigo|2021|Pop
drivers license|Olivia Rodrigo|2021|Pop
vampire|Olivia Rodrigo|2023|Pop
Birds of a Feather|Billie Eilish|2024|Pop
What Was I Made For?|Billie Eilish|2023|Pop
Beautiful Things|Benson Boone|2024|Pop
Lose Control|Teddy Swims|2023|R&B
Kill Bill|SZA|2022|R&B
Snooze|SZA|2022|R&B
Leave the Door Open|Silk Sonic|2021|R&B
Not Like Us|Kendrick Lamar|2024|Hip-Hop
MONTERO (Call Me By Your Name)|Lil Nas X|2021|Hip-Hop
INDUSTRY BABY|Lil Nas X|2021|Hip-Hop
Paint The Town Red|Doja Cat|2023|Hip-Hop
Heat Waves|Glass Animals|2020|Rock
Too Sweet|Hozier|2024|Folk
Stick Season|Noah Kahan|2022|Folk
Something in the Orange|Zach Bryan|2022|Country
Last Night|Morgan Wallen|2023|Country
Texas Hold 'Em|Beyoncé|2024|Country
Dynamite|BTS|2020|K-Pop
Butter|BTS|2021|K-Pop
How You Like That|BLACKPINK|2020|K-Pop
Pink Venom|BLACKPINK|2022|K-Pop
Ditto|NewJeans|2022|K-Pop
Super Shy|NewJeans|2023|K-Pop
Cupid|FIFTY FIFTY|2023|K-Pop
Supernova|aespa|2024|K-Pop
APT.|ROSÉ & Bruno Mars|2024|K-Pop
`;

export const catalog = rows
  .trim()
  .split("\n")
  .map((row, index) => {
    const [title, artist, year, genre] = row.split("|");
    return {
      id: `seed-${index}`,
      title,
      artist,
      year: Number(year),
      genre,
      origin: "curated",
    };
  });

export function mergeSongs(...collections) {
  const key = (value) =>
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(
        /\s*[-(]\s*(remaster(ed)?|radio edit|single version|album version).*$/i,
        "",
      )
      .replace(/[^\p{L}\p{N}]/gu, "");
  const byTitle = new Map();
  const output = [];
  for (const song of collections.flat()) {
    const title = key(song.title),
      artist = key(song.artist);
    const candidates = byTitle.get(title) || [];
    const duplicate = candidates.find(
      (existing) =>
        existing.id === song.id ||
        (artist &&
          (key(existing.artist).includes(artist) ||
            artist.includes(key(existing.artist)))),
    );
    if (duplicate) {
      duplicate.year ??= song.year;
      if (!duplicate.genre || duplicate.genre === "Unknown")
        duplicate.genre = song.genre;
      duplicate.spotifyUrl ||= song.spotifyUrl;
      duplicate.deezerId ||= song.deezerId;
    } else {
      const copy = { ...song };
      output.push(copy);
      candidates.push(copy);
      byTitle.set(title, candidates);
    }
  }
  return output;
}

export const genres = [...new Set(catalog.map((song) => song.genre))].sort();

export function filterCatalog(
  songs,
  { genre = "All", from = 1960, to = new Date().getFullYear() } = {},
) {
  return songs.filter(
    (song) =>
      (genre === "All" || song.genre === genre) &&
      (song.year == null
        ? Number(from) <= 1960 && Number(to) >= new Date().getFullYear()
        : song.year >= Number(from) && song.year <= Number(to)),
  );
}
