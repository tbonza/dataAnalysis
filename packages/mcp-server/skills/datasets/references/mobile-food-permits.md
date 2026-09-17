---
description: >-
  Mobile food (truck and pushcart) vending permits in San Francisco, one row per
  permit. Use when a question is about food truck or pushcart vendors, what they sell,
  where they're permitted to operate, or a permit's approval/expiration status.
---

# mobile-food-permits

SF's open-data mobile food facility permit export, converted from CSV. `Latitude` and
`Longitude` are `0` for permits with no valid geocode — prefer `Address` or
`LocationDescription` over the coordinate columns when a row's location matters.
`NOISent` is empty for every row. Load it with
`load_available_dataset({ name: "mobile-food-permits" })`.

## Fields

- `locationid` -- type: BIGINT, range: 364218 – 2019708
- `Applicant` -- type: VARCHAR, distinct: 124, values: Antojitos Mexicanos La Costenita, Antojitos la Patita, Athena SF Gyro, BH & MT LLC, BOWL'D ACAI, LLC., Bay Area Dots, LLC, Bay Area Mobile Catering, Inc. dba. Taqueria Angelica's, Bonito Poke, ..., Treats by the Bay LLC, Truly Food & More, Union Square Business Improvement District, Wonder Philly, Wu Wei LLC dba MoBowl, Ziaurehman Amini, Zuri Food Facilities, tacos y pupusas los trinos
- `FacilityType` -- type: VARCHAR, distinct: 2, values: Push Cart, Truck
- `cnn` -- type: BIGINT, range: 0 – 51657000
- `LocationDescription` -- type: VARCHAR, distinct: 361, values: 01ST ST: CLEMENTINA ST to FOLSOM ST (245 - 299), 01ST ST: HOWARD ST to TEHAMA ST (200 - 231), 01ST ST: STEVENSON ST to JESSIE ST (21 - 56), 01ST ST: TEHAMA ST to CLEMENTINA ST (232 - 274), 02ND ST: BRANNAN ST to TOWNSEND ST (600 - 699), 02ND ST: BRYANT ST to TABER PL (500 - 518), 02ND ST: FEDERAL ST to SOUTH PARK (519 - 548), 02ND ST: HOWARD ST to TEHAMA ST (200 - 227), ..., WASHINGTON ST: DRUMM ST intersection, WASHINGTON ST: THE EMBARCADERO to DRUMM ST (1 - 99), WATERLOO ST: MARENGO ST to BAY SHORE BLVD (40 - 99), WEBSTER ST: EDDY ST to ELLIS ST (1201 - 1299) -- WEST --, WILLIAMS AVE: APOLLO ST to PHELPS ST \ VESTA ST (300 - 399), WILLIAMS AVE: VENUS ST to APOLLO ST (250 - 331), YOSEMITE AVE: HAWES ST to INGALLS ST (1300 - 1399), YOSEMITE AVE: INGALLS ST to JENNINGS ST (1400 - 1499)
- `Address` -- type: VARCHAR, distinct: 429, values: 1 BUSH ST, 1 CALIFORNIA ST, 1 FRONT ST, 1 MARKET ST, 1 MONTGOMERY ST, 1 POST ST, 1 SANSOME ST, 1 THOMAS MORE WAY, ..., Assessors Block 5216/Lot030, Assessors Block 5369/Lot003, Assessors Block 5598/Lot031, Assessors Block 7283/Lot004, Assessors Block 7295/Lot022, Assessors Block 8722/Lot001, Assessors Block 8722/Lot003, Assessors Block 8732/Lot001
- `blocklot` -- type: VARCHAR, distinct: 417, values: 0012003A, 0013009, 0029007, 0042022, 0043001, 0137001, 0140007, 0175003, ..., 8714002, 8716001, 8718001, 8720013, 8722001, 8722003, 8723001, 8732001
- `block` -- type: VARCHAR, distinct: 301, values: 0012, 0013, 0029, 0042, 0043, 0137, 0140, 0175, ..., 8711, 8714, 8716, 8718, 8720, 8722, 8723, 8732
- `lot` -- type: VARCHAR, distinct: 103, values: 000, 001, 001A, 001B, 001D, 001U, 002, 002D, ..., 127, 132, 174, 183, 241, 261, 320, 606
- `permit` -- type: VARCHAR, distinct: 189, values: 12MFF-0083, 15MFF-0007, 15MFF-0039, 15MFF-0145, 15MFF-0159, 16MFF-0010, 16MFF-0011, 16MFF-0126, ..., 26MFF-00003, 26MFF-00004, 26MFF-00005, 26MFF-00006, 26MFF-00007, 26MFF-00008, 26MFF-00010, 26MFF-00011
- `Status` -- type: VARCHAR, distinct: 5, values: APPROVED, EXPIRED, ISSUED, REQUESTED, SUSPEND
- `FoodItems` -- type: VARCHAR, distinct: 150, values: 7 Multiple Trucks on rotation (1 on Mission Bay Blvd South & 6 on 4th St).   Serving everything but hot dogs, Acai Bowls: Poke Bowls: Smoothies: Juices, Acai Bowls: Smoothies: Juices, All types of food except for BBQ on site per fire safety. Partnership with Off the Grid and their fleet of MFF's, American Food: Hot dogs: pretzels: ice cream: salads: beverages: sandwiches: soup: coffee: pastries:etc., American classic slider:  fried chicken slider: fried chicken skin: wedge cut fries: regular cut fries: handcrafted sodas: spring salad, Artisan Pizzas (Margherita: Yukon Potato: Zoe's Pepperoni: Funghi: Brocolli Rabe: Bacon Kale:  Arugula) and Drinks., Asian Fusion - Japanese Sandwiches/Sliders/Misubi, ..., everything except for hot dogs, kebabs: halal gyro: grilled halal meat: refreshments, rice chicken beef hot dogs and sandwich's and coke and water, sunflower seeds: crackerjacks: bottled water: peanuts: candy, tacos, tacos: burritos: quesadilla: tortas sodas, varies truck to truck, various styles of hot dogs & sausages: chips: breakfast sandwiches: chili: soda: water:
- `X` -- type: DOUBLE, range: 5980806.006 – 6019956.89
- `Y` -- type: DOUBLE, range: 2086107.252 – 2122293.82162
- `Latitude` -- type: DOUBLE, range: 0 – 37.80774328845
- `Longitude` -- type: DOUBLE, range: -122.50959579625 – 0
- `Schedule` -- type: VARCHAR, distinct: 189, values: http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=12MFF-0083&ExportPDF=1&Filename=12MFF-0083_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=15MFF-0007&ExportPDF=1&Filename=15MFF-0007_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=15MFF-0039&ExportPDF=1&Filename=15MFF-0039_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=15MFF-0145&ExportPDF=1&Filename=15MFF-0145_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=15MFF-0159&ExportPDF=1&Filename=15MFF-0159_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=16MFF-0010&ExportPDF=1&Filename=16MFF-0010_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=16MFF-0011&ExportPDF=1&Filename=16MFF-0011_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=16MFF-0126&ExportPDF=1&Filename=16MFF-0126_schedule.pdf, ..., http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=26MFF-00003&ExportPDF=1&Filename=26MFF-00003_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=26MFF-00004&ExportPDF=1&Filename=26MFF-00004_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=26MFF-00005&ExportPDF=1&Filename=26MFF-00005_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=26MFF-00006&ExportPDF=1&Filename=26MFF-00006_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=26MFF-00007&ExportPDF=1&Filename=26MFF-00007_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=26MFF-00008&ExportPDF=1&Filename=26MFF-00008_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=26MFF-00010&ExportPDF=1&Filename=26MFF-00010_schedule.pdf, http://bsm.sfdpw.org/PermitsTracker/reports/report.aspx?title=schedule&report=rptSchedule&params=permit=26MFF-00011&ExportPDF=1&Filename=26MFF-00011_schedule.pdf
- `dayshours` -- type: VARCHAR, distinct: 59, values: Fr:11AM-3PM, Fr:6AM-8PM, Mo-Fr:10AM-11AM, Mo-Fr:10AM-3PM, Mo-Fr:10AM-4PM, Mo-Fr:11AM-12PM, Mo-Fr:11AM-3PM, Mo-Fr:12PM-1PM, ..., Tu/Th/Fr:10AM-3PM, Tu/Th/Fr:9AM-1PM, Tu/Th:6AM-8PM, Tu/Th:9AM-3PM, Tu/We/Th:10AM-8PM, Tu/We/Th:12AM-3AM;Mo-We:12PM-12AM, We/Th/Fr:6AM-6PM, We:6AM-8PM
- `NOISent` -- type: VARCHAR, distinct: 0, values: 
- `Approved` -- type: VARCHAR, distinct: 63, values: 2017 Aug 01 12:00:00 AM, 2017 Aug 29 12:00:00 AM, 2017 Mar 09 12:00:00 AM, 2017 Mar 16 12:00:00 AM, 2017 Mar 21 12:00:00 AM, 2018 Apr 09 12:00:00 AM, 2018 Aug 07 12:00:00 AM, 2018 Aug 09 12:00:00 AM, ..., 2025 Nov 21 12:00:00 AM, 2025 Nov 24 12:00:00 AM, 2025 Nov 26 12:00:00 AM, 2026 Feb 02 12:00:00 AM, 2026 Jan 02 12:00:00 AM, 2026 Jan 22 12:00:00 AM, 2026 Jun 04 12:00:00 AM, 2026 Jun 16 12:00:00 AM
- `Received` -- type: BIGINT, range: 20120403 – 20260909
- `PriorPermit` -- type: BIGINT, range: 0 – 1
- `ExpirationDate` -- type: VARCHAR, distinct: 20, values: 2016 Mar 15 12:00:00 AM, 2017 Jul 19 12:00:00 AM, 2017 Mar 15 12:00:00 AM, 2018 Jan 30 12:00:00 AM, 2018 Jul 15 12:00:00 AM, 2018 Mar 15 12:00:00 AM, 2019 Feb 28 12:00:00 AM, 2019 Jul 15 12:00:00 AM, ..., 2021 Jul 15 12:00:00 AM, 2021 Nov 15 12:00:00 AM, 2022 Nov 15 12:00:00 AM, 2023 Nov 15 12:00:00 AM, 2024 Nov 15 12:00:00 AM, 2025 Jul 15 12:00:00 AM, 2025 Nov 15 12:00:00 AM, 2026 Nov 15 12:00:00 AM
- `Location` -- type: VARCHAR, distinct: 396, values:     (0.0, 0.0),     (37.70863992532727, -122.40579191247869),     (37.708677484233256, -122.40551636562863),     (37.70937546400143, -122.40415437850858),     (37.710003334289446, -122.47141191312888),     (37.71019301997575, -122.4552219061259),     (37.710451691867526, -122.39614907899559),     (37.7108412835853, -122.39964261496316), ...,     (37.800547847947854, -122.43971598582868),     (37.80065022766383, -122.43978589230416),     (37.80457786909011, -122.43301077434302),     (37.805049509058854, -122.41433443693992),     (37.805885350100986, -122.41594524663745),     (37.80743449558139, -122.41666095486075),     (37.8077425455166, -122.41434852163367),     (37.80774328844553, -122.42414994486982)

## What it can answer

Vendor counts by `FacilityType` (Push Cart vs. Truck) or `Status`, what a vendor sells
(`FoodItems`), where vending is permitted (`Address`/`LocationDescription`/`block`), and
approval/expiration timelines (`Approved`, `Received`, `ExpirationDate`). There is no
sales, revenue, or inspection-score data, so questions about a vendor's business
performance or health-code history are out of scope.

## Joining with other datasets

This dataset has no neighborhood or supervisor-district column, so it cannot join on the
categorical key that `film-locations` and `registered-businesses` share (see either of
their reference docs). But `Latitude`/`Longitude` **are** a usable spatial key for most
rows — 464 of 500 have a real geocode; the rest are `0` placeholders and should be
filtered out (`Latitude != 0 AND Longitude != 0`) before any spatial use.

**A proximity join with `film-locations` works through the `query` tool**, using its
`spatialJoin` field on `Longitude`/`Latitude` — 1,817 film-shoot/food-truck-permit pairs
fall within 150m of each other, the closest a couple of metres apart (same corner).
Remember the `!= 0` filter, or the placeholder rows drag the result off the map:

```json
{
  "spatialJoin": {
    "datasetId": "<film-locations id>",
    "lonColumn": "Longitude", "latColumn": "Latitude",
    "otherLonColumn": "Longitude", "otherLatColumn": "Latitude",
    "withinMeters": 150
  },
  "where": [{ "column": "Latitude", "operator": "!=", "value": 0 }]
}
```

See the **data-query** skill's `references/spatial-join.md` for the full grammar.

`registered-businesses` cannot be spatial-joined directly: it keeps its coordinates in a
WKT `Business Location` string rather than numeric columns, and nothing here parses WKT.
Matching by name (`Applicant` vs. its `Ownership Name`/`DBA Name`) is a much weaker
option — naming conventions differ (LLC suffixes, abbreviations, punctuation) and would
produce a low, misleading match rate.

## Source

[Mobile Food Facility Permit](https://data.sf.gov/Economy-and-Community/Mobile-Food-Facility-Permit/rqzj-sfat/about_data)
(Socrata ID `rqzj-sfat`), maintained by SF Public Works — this dataset's columns
(`Applicant`, `FacilityType`, `Status`, `Schedule`, `dayshours`, ...) match it exactly.
A related but separate upstream dataset,
[Mobile Food Schedule](https://data.sf.gov/Economy-and-Community/Mobile-Food-Schedule/jjew-r69b/about_data)
(`jjew-r69b`), publishes one row per recurring day/start-time/end-time slot for each
permit (no `Status` or approval columns) and is not currently packaged here.
