var config = require('./config');
var express = require('express');
var http = require('http');
var request = require('request');
var path = require('path');
var pg = require('pg');
var fs = require('fs');


// Initialize application
var app = express();


// Configure Express
app.configure(function(){
  app.set('port', process.env.PORT || 80);
  app.set('views', __dirname + '/views');
  // app.set('view engine', 'ejs');
  app.set('view engine', 'html');
  // app.enable('view cache');
  app.engine('html', require('hogan-express'));
  app.set('layout', 'layout');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    next();
  });
  app.use(express.compress());
  app.use(express.methodOverride());
  app.use(express.cookieParser('mozbei010102'));
  app.use(express.session());
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});


var client = new pg.Client(config.pg.conString);
client.connect();


app.get('/edge',
function(req, res) {

  var lonlat = [req.query.lon, req.query.lat];
  
  var search_factor = 20;

  var lon = parseFloat(lonlat[0]);
  var lat = parseFloat(lonlat[1]);
  var lonmin = parseFloat(lon - search_factor);
  var latmin = parseFloat(lat - search_factor);
  var lonplus = parseFloat(lon + search_factor);
  var latplus = parseFloat(lat + search_factor);

  var sql = "SELECT id, \
              osm_name,\
              source, \
              target, \
              geom_way, \
              ST_Distance( \
                geom_way, \
                ST_GeometryFromText(\'POINT("+lon+" "+lat+")\', 4326) \
              ) AS dist \
             FROM \
                mz_2po_4pgr \
             WHERE \
                geom_way && \
                ST_Setsrid(\'BOX3D("+lonmin+" "+latmin+","+lonplus+" "+latplus+")\'::box3d, 4326) \
             ORDER BY \
                dist \
             LIMIT 1";
  var query = client.query(sql, []);

  query.on('row', function(row) {
    console.log('row:', row);
    return res.json(JSON.stringify(row));
  });
  query.on('error', function(error) {
    console.log(error);
  });
});


app.get('/catchment',
function(req, res) {

  var length = parseFloat(req.query.length);
  var startingPoint = parseFloat(req.query.startingpoint);

  var sql = "SELECT * \
      FROM mz_2po_4pgr \
      JOIN \
      (SELECT id2 AS vertex_id, cost FROM pgr_drivingdistance(' \
            SELECT id, \
                source, \
                target, \
                cost \
            FROM mz_2po_4pgr', \
            " + startingPoint + ", \
            " + length + ", \
            false, \
            false)) AS route \
      ON mz_2po_4pgr.id = route.vertex_id";

  var query = client.query(sql, function(err, result) {
    //NOTE: error handling not present
    if(result) {
      var json = JSON.stringify(result.rows);
      // console.log(json);
      res.json(json);
    } else {
      console.log(err);
      res.json({});
    }
  });
  query.on('error', function(error) {
    console.log(error);
  });
});


app.get('/',
function(req, res) {
    res.render('index.html', {});
});


// Server at fixed port 80, requires sudo
http.createServer(app).listen(80, function(){
  console.log("Express server listening on port 80");
});

