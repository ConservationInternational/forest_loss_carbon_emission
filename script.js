/*
=================================================================================================
Script Description:
This (Google Earth Engine) script takes the thresholded forest cover dataset and overlays it with annual tree cover loss.
The remaining forest cover is then calculated in terms of carbon (t) using above- and below-ground 
biomass (converted to biomass carbon) and soil organic carbon. The carbon lost (t) in areas where 
forest loss occurs was then converted to CO2 for carbon emissions (CO2/ha).
=================================================================================================
Primary satellite data used:
(1) Global forest loss - tree cover, forest loss (Hansen, 2014)
(2) Above-ground biomass (Woods Hole, 2018)
=================
Ancillary datasets:
[1] Threshold for global forest definition (Hansen, 2010: https://www.pnas.org/content/107/19/8650)
[2] Conversion of above-ground to below-ground biomass (Mokany et al. 2006)
[3] Conversion of biomass to biomass carbon
[4] Conversion of carbon (t) to carbon emissions
[5] Input dataset of boundary within which to estimate Expected Outputs below
==================
Expected Outputs:
ha - hectares within given boundary
fc - forest cover (ha) by year
fl - forest loss (ha) by year
cb - carbon stored (t)
ce - carbon emissions (CO2/ha)
=================================================================================================
*/

// user input
var tree_cover = 30; // Minimum tree cover to be considered a forest, in canopy cover by percent
var yr_str = 2000;
var yr_end = 2021; // latest is 2021

// Enter the ISO code to filter your analysis
var site_name = 'BRA'; // example of filter to Eswatini (ISO = SWZ)
// For more info: https://www.nationsonline.org/oneworld/country_code_list.htm
// //======================================================================================================================================
// This function computes the feature's geometry area (m2), converts to ha, and adds it as a property.
var addArea = function(feature) {
  return feature.set({ha: feature.geometry().area().multiply(0.0001)});
};
// //======================================================================================================================================  
// Adds all countries of the world, uncomment to run all countries
// var sa = ee.FeatureCollection('//insert GADM country boundaries downloaded dataset path here//');//all countries of the world
// var sa = ee.FeatureCollection("//insert GADM country boundaries downloaded dataset path here//").filter(ee.Filter.eq('GID_0', site_name));

// TODO: Add a countries layer, for example, GADM, or your own shapefile
var table = 'FAO/GAUL/2015/level0';
var sa = ee.FeatureCollection(table); // if you are adding a unique table/shapefile for your analysis
var sa = table.filter(ee.Filter.eq('COUNTRY', 'Brazil'));

//Prints the first feature in feature collection
print(sa.first(), 'BRA');

//Adds ha to your table
var sa_area = sa.map(addArea);
//======================================================================================================================
//Add datasets
// Import Hansen global forest dataset
var hansen = ee.Image("UMD/hansen/global_forest_change_2021_v1_9");

// woody plants above ground biomass (tons/ha) from GFW
// TODO: Add Above-ground biomass,for example, from Global Forest Watch
var agb_data_path = 'path/to/above_ground_biomass';
var agb = ee.ImageCollection(agb_data_path).mosaic();
//======================================================================================================================
// This function computes the feature's geometry area (m2), converts to ha, and adds it as a property.
var addArea = function(feature) {
  return feature.set({area_ha: feature.geometry().area().multiply(0.0001)});
};
//======================================================================================================================
// Map the area getting function over the FeatureCollection.
var sa = sa.map(addArea); //now there is area_ha column in your district table
print(sa_area.first(), 'Study Area');
Map.centerObject(sa_area,7);
Map.addLayer(sa_area,{},"Study Area",false);
//======================================================================================================================
// calculate average above and below ground biomass
// BGB (t ha-1) Citation Mokany et al. 2006 = (0.489)*(AGB)^(0.89)
// Mokany used a linear regression of root biomass to shoot biomass for 
// forest and woodland and found that BGB(y) is ~ 0.489 of AGB(x).  
// However, applying a power (0.89) to the shoot data resulted in an improved model 
// for relating root biomass (y) to shoot biomass (x):
// y = 0:489 x0:890
var bgb = agb.expression('0.489 * BIO**(0.89)', {'BIO': agb});

// Calculate Total biomass (t/ha) then convert to carbon equilavent (*0.5) to get Total Carbon (t ha-1) = (AGB+BGB)*0.5
var tbcarbon = agb.expression('(bgb + abg ) * 0.5 ', {'bgb': bgb,'abg': agb});

// convert Total Carbon to Total Carbon dioxide tCO2/ha; 
// One ton of carbon equals 44/12 = 11/3 = 3.67 tons of carbon dioxide
var teco2 = agb.expression('totalcarbon * 3.67 ', {'totalcarbon': tbcarbon});
//======================================================================================================================
// define forest cover at the starting date
var fc_str = ee.Image(1).updateMask(hansen.select('treecover2000').gte(tree_cover))
                        .updateMask(hansen.select('lossyear').gte(yr_str-2000+1).unmask(1))
                        .rename('fc'+(yr_str));

// Display layers on screen 
Map.addLayer(agb,{min:0,max:500,palette:["blue","yellow","red"]},"agb 2000",false);
Map.addLayer(hansen.select('treecover2000'),{min:0,max:100,palette:["grey","darkgreen"]},"% tree cover 2000",false);
Map.addLayer(fc_str,{min:0,max:1,palette:["green"]},"forest 2000",false);
var loss_period = hansen.select('treecover2000').gte(tree_cover).and(hansen.select('lossyear').gt(yr_str-2000).and(hansen.select('lossyear').lte(yr_end-2000)));
Map.addLayer(hansen.select('lossyear').updateMask(loss_period),{min:0,max:17,palette:["blue","yellow","red"]},"forest loss period years",false);

// using forest cover at the start year, identify losses per year
var fl_stack = ee.Image().select();
for (var k = yr_str-2000+1; k <= yr_end-2000 ; k += 1) {
  var fl = fc_str.updateMask(hansen.select('lossyear').eq(k)).rename('fl'+(k+2000));
  var fl_stack = fl_stack.addBands(fl);}

// use the losses per year to compute forest extent per year
var fc_stack = fc_str;
for (var k = yr_str-2000+1; k <= yr_end-2000 ; k += 1) {
  var fc =  fc_stack.select('fc'+(k+2000-1)).updateMask(fl_stack.select('fl'+(k+2000)).unmask(0).neq(1)).rename('fc'+(k+2000));
  var fc_stack = fc_stack.addBands(fc);}

// use annual forest extent to estimate annual forest biomass in tons C/ha
var cb_stack = ee.Image().select();
for (var k = yr_str-2000; k <= yr_end-2000 ; k += 1) {
  var cb =  tbcarbon.updateMask(fc_stack.select('fc'+(k+2000)).eq(1)).rename('cb'+(k+2000));
  var cb_stack = cb_stack.addBands(cb);}

// use annual forest loss to estimate annual emissions from deforestation in tons CO2/ha
var ce_stack = ee.Image().select();
for (var k = yr_str-2000+1; k <= yr_end-2000 ; k += 1) {
  var ce =  teco2.updateMask(fl_stack.select('fl'+(k+2000)).eq(1)).rename('ce'+(k+2000));
  var ce_stack = ce_stack.addBands(ce);}

// combine all the datasets into a multilayer stack
var output = fc_stack.addBands(fl_stack).addBands(cb_stack).addBands(ce_stack);

// compute pixel areas in hectareas
var areas =  output.multiply(ee.Image.pixelArea().divide(10000));

// compute statistics for the regions
var stats = areas.reduceRegions({collection: sa_area, reducer: ee.Reducer.sum(), scale: 30});
//======================================================================================================================
// Export these statistics to a CSV table
Export.table.toDrive({
  collection: stats,
  description:  site_name+'_Forest_Change_'+yr_str+'_'+yr_end+'_'+tree_cover+'_pct_canopy_cover',
  fileNamePrefix: site_name+'_Forest_Change_'+yr_str+'_'+yr_end+'_'+tree_cover+'_pct_canopy_cover',
  selectors: (["GID_0","NAME_0","ha","fc2000","fc2001", "fc2002","fc2003","fc2004","fc2005","fc2006","fc2007","fc2008","fc2009","fc2010","fc2011","fc2012","fc2013","fc2014","fc2015","fc2016","fc2017","fc2018","fc2019","fc2020", "fc2021",
  "fl2001", "fl2002","fl2003","fl2004","fl2005","fl2006","fl2007","fl2008","fl2009","fl2010","fl2011","fl2012","fl2013","fl2014","fl2015","fl2016","fl2017","fl2018","fl2019","fl2020","fl2021",
  "cb2000","cb2001", "cb2002","cb2003","cb2004","cb2005","cb2006","cb2007","cb2008","cb2009","cb2010","cb2011","cb2012","cb2013","cb2014","cb2015","cb2016","cb2017","cb2018","cb2019","cb2020","cb2021",
  "ce2001","ce2002","ce2003","ce2004","ce2005","ce2006","ce2007","ce2008","ce2009","ce2010","ce2011","ce2012","ce2013","ce2014","ce2015","ce2016","ce2017","ce2018","ce2019","ce2020","ce2021"]),
  
  folder: 'Output_Yearly_Stats',
  fileFormat: 'CSV'}); 
