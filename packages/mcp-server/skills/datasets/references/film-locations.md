---
description: >-
  Every filming location recorded for movies and TV productions shot in San Francisco,
  one row per location per production, spanning 1915-2025. Use when a question is about
  where film/TV productions have shot in the city, which neighborhoods or landmarks
  appear on screen most often, or a specific production's cast, crew, or studio.
---

# film-locations

SF's open-data film-locations export, converted from CSV. A production with multiple
shooting locations has one row per location, so counting "productions" means counting
distinct `Title` values, not rows. `Fun Facts`, cast, and crew columns are sparse — many
rows have no value. Load it with `load_available_dataset({ name: "film-locations" })`.

## Fields

- `Title` -- type: VARCHAR, distinct: 350, values: 180, 24 Hours on Craigslist, 40 Days and 40 Nights, 48 Hours, 50 First Dates, A Jitney Elopement, A Man on The Inside, A Night Full of Rain, ..., What's Up Doc?, When We Rise, When a Man Loves a Woman, Woman on Top, Woman on the Run, Women is Losers, Yours, Mine and Ours, Zodiac
- `Release Year` -- type: BIGINT, range: 1915 – 2025
- `Locations` -- type: VARCHAR, distinct: 1756, values: "Metzger's Apt" 151 Alice B. Toklas Pl., 0-100 block Halleck Street, 1 Bush Street, 1 Front St, 1 Market St. Landmark Building, 1 Montgomery Street at Post, 1 Post Street, 1 Urbano, ..., Yerba Buena Gardens, Yerba Buena Island, York & 24th St., York Hotel (940 Sutter Street), Z Space Studios; 450 Florida St., Zoe St btwn Brannan and Freelon St, de Young Museum/Golden Gate Park, skyline/ exterior scenes
- `Fun Facts` -- type: VARCHAR, distinct: 188, values: 3 characters run out of stadium, there is a group of people on the sidewalk, an earthquake hits, and they duck for cover, 3 characters walk down the street. An earthquake shakes the city and stuff starts breaking. One character gets a shard of glass stuck in his leg., A Muni station agent played himself in this scene., A couple reminisces on the moment they first fell in love, A partially-above ground parking structure near the building made it necessary for architects to make the Alcoa Building's diagonal bracing visible, instead of placing it inside and drastically reducing the amount usable interior space., Aerial and exterior shots, Aerial shots, After the devastating earthquake of 1906, the park served as a refugee camp for more than 1600 families who lost their home in the disaster., ..., With 23 miles of ladders and 300,000 rivets in each tower, the Golden Gate Bridge was the world's longest span when it opened in 1937., continuous driving shots of a taxi going with the flow of existing traffic, demolished, dialogue scene, dialogue scene on top of a garage roof, group of friends have a heated argument, then flashback of pre-argument, rebate folder under films - to confirm, two paragliders land on the field of AT&T Park
- `Production Company` -- type: VARCHAR, distinct: 223, values: 1492 Pictures, 20th Television, 3 Ring Circus Films, 3311 Productions, 415 Productions, Adobe Pictures, Inc., Alan Jacobs Productions, Alfred J. Hitchcock Productions, ..., Walt Disney Productions, Warner Bros. Pictures, Warner Brothers / Seven Arts, Warner Brothers / Seven Arts Seven Arts, White Dwarf Productions, Yerba Buena Productions, Zee Films, unlisted
- `Distributor` -- type: VARCHAR, distinct: 143, values: 01 Distribution, 10 Distribution, 11 Distribution, 12 Distribution, 13 Distribution, 14 Distribution, 2 Distribution, 3 Distribution, ..., Warner Bros. Television, Warner Brothers, Warner Brothers / Seven Arts, Warner brothers Pictures, Weinstein Company, Windline Films, Wolfe Video, Zealot Pictures
- `Director` -- type: VARCHAR, distinct: 290, values: Adam Shankman, Alan Crosland, Alan Jacobs, Alan Parker, Alan Poul, Silas Howard, Stacie Passon, Alan Taylor, Albert Brooks, Alex Garland, ..., Wayne Wang, William Arntz, William Friedkin, Wim Wenders, Wolfgang Petersen, Woody Allen, Zachary Shedd, Zal Batmanglij
- `Writer` -- type: VARCHAR, distinct: 308, values: Aaron Sorkin, Alan Black, Alan Jacobs, Alan R. Trustman, Albert Brooks, Alec Coppel, Alex Garland, Alexander Bulkley & Kelley Bulkeley, ..., William Harrison, William Rose, Wim Wenders, Wolfgang Petersen, Woody Allen, Yuri Zeltser, Zachary Shedd, Zal Batmanglij, Brit Marling
- `Actor 1` -- type: VARCHAR, distinct: 265, values: Aaron Eckhart, Aaron Paul, Aaron Taylor-Johnson, Adam Devine, Adam Rose, Adam Sandler, Al Jolson, Alan Arkin, ..., Will Smith, William Hurt, William Powell, William Shatner, Wood Moy, Woody Allen, Zasu Pitts, Zoe Kavan
- `Actor 2` -- type: VARCHAR, distinct: 275, values: Aaliyah, Alec Baldwin, Alexandra Shipp, Alexis Smith, Alice Faye, Alyson Hannigan, Amy Irving, Andy Garcia, ..., Tyne Daly, Valentina Cortese, Viggo Mortenson, Warren Keith, Wesley Snipes, Will Sasso, William Forsythe, Yul Brynner
- `Actor 3` -- type: VARCHAR, distinct: 170, values: Adrian Grenier, Aisha Tyler, Allen Garfield, Amanda Rea, Andrew Garfield, Andy Serkis, Anne Baxter, Anne Kronenberg, ..., Victor Wong, Ving Rhames, Warner Oland, William Holden, William Lundigan, Woody Harrelson, Yu Xia, Zachary Quinto
- `Point` -- type: VARCHAR, distinct: 1390, values: POINT (-121.5357205 36.8459168), POINT (-122.3648992 37.8102258), POINT (-122.3658344 37.8193829), POINT (-122.3668348 37.8108709), POINT (-122.3691522 37.7406735), POINT (-122.3699786 37.825284), POINT (-122.3701676 37.7288356), POINT (-122.371174 37.8173771), ..., POINT (-122.5072394 37.7455566), POINT (-122.5085195 37.7798726), POINT (-122.5088513 37.7714515), POINT (-122.5094898 37.779894), POINT (-122.510734 37.7593921), POINT (-122.51365 37.7804444), POINT (-122.5137962 37.7783123), POINT (-122.5300777 37.8451837)
- `Longitude` -- type: DOUBLE, range: -122.5300777 – -121.5357205
- `Latitude` -- type: DOUBLE, range: 36.8459168 – 37.8961157
- `Analysis Neighborhood` -- type: VARCHAR, distinct: 40, values: Bayview Hunters Point, Bernal Heights, Castro/Upper Market, Chinatown, Excelsior, Financial District/South Beach, Glen Park, Golden Gate Park, ..., Seacliff, South of Market, Sunset/Parkside, Tenderloin, Treasure Island, Twin Peaks, West of Twin Peaks, Western Addition
- `Supervisor District` -- type: BIGINT, range: 1 – 11
- `data_as_of` -- type: VARCHAR, distinct: 1, values: 2026/02/20 04:37:46 PM
- `data_loaded_at` -- type: VARCHAR, distinct: 1, values: 2026/02/20 04:44:43 PM

## What it can answer

Geographic concentration of filming (which `Analysis Neighborhood` or `Supervisor
District` shows up most), the most-filmed specific locations, productions by
`Release Year`, and cast/crew/production-company/distributor lookups for a named film.
There is no box office, budget, genre, or runtime data, so questions about a film's
commercial performance or content are out of scope — this dataset only knows *where* and
*when* it was shot.
