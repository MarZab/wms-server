/*
*  WMS Server
*  marko@zabreznik.net
* */

var
  express = require("express"),
  app = express(),
  fs = require('fs'),
  im = require('imagemagick');
  _ =require('lodash'),
  async = require('async');

// serve static files
app.use(express.static(__dirname + '/public'));
app.get("/", function (req, res) {
  res.redirect("/index.html");
});


function Layer(data) {
  this.name = '';
  this.size_x = 0; // size of pixel (in meters)
  this.size_y = 0;
  this.rotate_x = 0; // rotation of map (in wtf?)
  this.rotate_y = 0;
  this.offset_x = 0; // offset (in meters)
  this.offset_y = 0;
  _.assign(this, data);
}
Layer.layers = {};
Layer.prototype.getCropFromBB = function ( bb ) {
  // return crop data in pixels
  //console.log(bb, this);
  return [
    Math.round((bb[2] - bb[0]) / Math.abs(this.size_x)), // width
    Math.round((bb[3] - bb[1]) / Math.abs(this.size_y)), // height
    Math.round((bb[0]- this.offset_x) / this.size_x), // offsetx
    Math.round((bb[3]- this.offset_y) / this.size_y) // offsety
  ];
};



fs.readdir('layers', function (err, files) {
  files.forEach(function (file) {
    var match = file.match(/^([^.]+).tfw$/);
    if (match) {
      var array = _.reject(_.map(fs.readFileSync('layers/'+match[1]+'.tfw').toString().split(/\r?\n/), parseFloat), _.isNaN);
      Layer.layers[match[1]] = new Layer({
        name: match[1], size_x: array[0], rotate_x: array[1], rotate_y: array[2],
        size_y: array[3], offset_x: array[4], offset_y: array[5]
      });
    }
  });
});

var formats = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif'
};

// serve wms
app.get('/wms', function (req, res, next) {

  var request = req.query.request ? req.query.request : 'GetMap';

  // serve capabilities
  if (request === 'GetCapabilities') {
    return res.json(200, Layer.layers);
  }

  if (request === 'GetMap') {

    console.log('req-----------------');

    // width/ height
    var query_height = parseFloat( req.query.height);
    var query_width = parseFloat(req.query.width);
    if (query_height < 100 || query_width < 100 ) {
      return next({message:'too small dimensions'});
    }

    // FORMAT
    var query_format = 'image/jpeg'; // default format jpg
    if (req.query.format) {
      if (formats[req.query.format]) query_format = req.query.format;
    }

    // LAYERS
    var query_layers = req.query.layers.split(',');
    if (query_layers.length < 1) {
      return next({'message': 'no layers'});
    }

    var query_bb = _.map(req.query.bbox.split(','), parseFloat);
    console.log('bb:',query_bb);

    return async.map(
      query_layers,
      function (lname, callback ) {
        var layer = Layer.layers[lname];
        if (!layer) return callback({message:'Layer does not exist.'});
        var bounds = layer.getCropFromBB(query_bb);
        var tmpname = 'W:\\wms-temp\\'+layer.name + Math.random().toString(36).substring(7) + '.png';

        console.log(bounds, tmpname);

        im.convert([
            'layers/'+layer.name+'.TIF',
            '-border', '1000',
            '-crop', bounds[0]+'x'+bounds[1]+'+'+ (bounds[2]+1000) +'+'+ (bounds[3]+1000),
            '-resize', query_width + 'x' + query_height,
            tmpname
          ],
          function (err) {
            if (err) return callback(err);
            return callback(null, {name: tmpname, bounds: bounds})
          }
        );
      },
      function (err, layers) {
        if (err) return next(err);

        if (layers.length === 1) {
          return res.sendfile(layers[0].name);
        }

        var final = 'W:\\wms-temp\\final'+ Math.random().toString(36).substring(7) + '.jpg';
        var commands = [
          '-average'
        ];
        for (l in layers) {
          commands.push(layers[l].name);
        }
        commands.push(final);
        console.log(commands);
        im.convert(commands, function (err, stdout, stderr) {
          if (err) return next(err);
          res.sendfile(final);
        });

      });
  }

  next();
});

app.use(function(err, req, res, next){
  res.send(500, err.message);
});

// done!
app.listen(process.env.NODE_ENV || 80);