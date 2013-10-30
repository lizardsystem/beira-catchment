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
  app.set('port', process.env.PORT || 3033);
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

// var pgroutingTable = 'routing_beira_new';
var pgroutingTable = 'mz_2po_4pgr';
// var geometryFieldName = 'geom';
var geometryFieldName = 'geom_way';

var client = new pg.Client(config.pg.conString);
client.connect();


app.get('/edge',
function(req, res) {

  var lonlat = [req.query.lon, req.query.lat];
  console.log('lonlat:',lonlat);
  var search_factor = .01;

  var lon = parseFloat(lonlat[0]);
  var lat = parseFloat(lonlat[1]);
  var lonmin = parseFloat(lon - search_factor);
  var latmin = parseFloat(lat - search_factor);
  var lonplus = parseFloat(lon + search_factor);
  var latplus = parseFloat(lat + search_factor);

  var sql = "SELECT id::int4, \
              osm_name::VARCHAR,\
              source::int8, \
              target::int8, \
              "+geometryFieldName+", \
              ST_Distance( \
                ST_Transform("+geometryFieldName+", 4326), \
                ST_GeometryFromText(\'POINT("+lon+" "+lat+")\', 4326) \
              ) AS dist \
             FROM \
                "+pgroutingTable+" \
             ORDER BY \
                dist \
             LIMIT 1";

  console.log('edge sql: ', sql);             
  var query = client.query(sql, []);

  query.on('row', function(row) {
    console.log('row:', row);
    return res.json(JSON.stringify(row));
  });
  query.on('error', function(error) {
    console.log(error);
  });
});

app.get('/alpha',
function(req, res) {

  var length = parseFloat(req.query.length);
  if(!length) length = 1;
  // var startingPoint = parseFloat(req.query.startingpoint);
  var startingPoint = 46759;

  var sql1 = "DROP TABLE IF EXISTS node;CREATE TEMPORARY TABLE node AS      \
                SELECT id,                                                  \
                    ST_X("+geometryFieldName+") AS x,                       \
                    ST_Y("+geometryFieldName+") AS y,                       \
                    geom                                                    \
                    FROM (                                                  \
                        SELECT source AS id,                                \
                            ST_StartPoint("+geometryFieldName+") AS geom    \
                            FROM "+pgroutingTable+"                         \
                        UNION                                               \
                        SELECT target AS id,                                \
                            ST_EndPoint("+geometryFieldName+") AS geom      \
                            FROM "+pgroutingTable+"                         \
                    ) AS node";


  var sql2 = "SELECT * FROM pgr_alphashape('               \
                SELECT *                                   \
                    FROM node                              \
                    JOIN                                   \
                    (SELECT * FROM pgr_drivingDistance(''  \
                        SELECT gid AS id,                  \
                            source::int4 AS source,        \
                            target::int4 AS target,        \
                            cost::float8 AS cost           \
                            FROM "+pgroutingTable+"'',     \
                        "+startingPoint+", "+length+", true, false)) \
                    AS dd ON node.id = dd.id1'::text)";

  // console.log('alpha sql1: ', sql1);
  // console.log('alpha sql2: ', sql2);

  var query = client.query(sql1, function(err1, result1) {
    //NOTE: error handling not present
    if(result1) {
      var query2 = client.query(sql2, function(err2, result2) {
        if(result2) {
          var json = JSON.stringify(result2.rows);
          res.json(json);
        } else {
          console.log('alpha error 2:', err2)
          res.json('{}');
        }
      });
    } else {
      console.log('alpha error 1:', err1);
      res.json('{}');
    }
  });
  query.on('error', function(error) {
    console.log(error);
  });
});

app.get('/route',
function(req, res) {

  var startEdge = parseFloat(req.query.startedge);
  var endEdge = parseFloat(req.query.endedge);

  var sql = "SELECT * FROM pgr_dijkstra( \
               'SELECT id, \
                       source::int4 AS source, \
                       target::int4 AS target, \
                       cost::float8, \
                       reverse_cost::float8 AS reverse_cost \
                FROM \
                       "+pgroutingTable+"', \
                       "+startEdge+", "+endEdge+", false, false) \
              JOIN "+pgroutingTable+" \
              ON id2 = "+pgroutingTable+".id ORDER BY seq";

  var query = client.query(sql, function(err, result) {
    //NOTE: error handling not present
    if(result) {
      var json = JSON.stringify(result.rows);
      console.log(json);
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

app.get('/catchment',
function(req, res) {

  var length = parseFloat(req.query.length);
  // var length = 1;
  var startingPoint = parseFloat(req.query.startingpoint);
  var max = req.query.max;

  var sql = "SELECT *                                           \
      FROM "+pgroutingTable+"                                   \
      JOIN                                                      \
      (SELECT id2 AS vertex_id, cost FROM pgr_drivingdistance(' \
            SELECT id AS id,                                   \
                source::int4,                                   \
                target::int4,                                   \
                cost::float8                                    \
            FROM "+pgroutingTable+"',                           \
            " + startingPoint + ",                              \
            " + length + ",                                     \
            false,                                              \
            false)) AS route                                    \
      ON "+pgroutingTable+".id = route.vertex_id ORDER BY "+pgroutingTable+".cost LIMIT " + max;

  console.log('catchment sql: ', sql);

  var query = client.query(sql, function(err, result) {
    //NOTE: error handling not present
    if(result) {
      var json = JSON.stringify(result.rows);
      // console.log(json);
      res.json(json);
    } else {
      console.log('catchment error:', err);
      res.json('{}');
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
http.createServer(app).listen(3033, '0.0.0.0');
// http.createServer(app).listen(80, '0.0.0.0');