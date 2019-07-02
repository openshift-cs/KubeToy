/*
  SETUP CONSTANTS
 */
const express = require('express');
const bodyParser = require('body-parser');
const validFilename = require('valid-filename');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dns = require('dns');
const appVersion = '1.2.2';


/*
  CONFIGURE APPLICATION
 */
let app = express();
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({
  extended: true
}));

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.set('port', process.env.PORT || 8080);


/*
  CONFIGURE MICROSERVICE
 */
let service = process.env.MICROSERVICE_NAME;
let serviceIP = process.env.MICROSERVICE_IP || process.env[service + '_SERVICE_HOST'];
let servicePort = process.env.MICROSERVICE_PORT || process.env[service + '_SERVICE_PORT'] || 8080;


/*
  SET GLOBAL VARIABLES
 */
// File paths
let configFile = process.env.CONFIG_FILE || '/var/config/config.json';
let secretFile = process.env.SECRET_FILE || '/var/secret/secret.txt';
let directory = process.env.PERSISTENT_DIRECTORY || '/var/demo_files';

if (!path.isAbsolute(configFile)) { configFile = path.resolve(__dirname, configFile); }
if (!path.isAbsolute(secretFile)) { secretFile = path.resolve(__dirname, secretFile); }
if (!path.isAbsolute(directory)) { directory = path.resolve(__dirname, directory); }

// Pod name
let pod = process.env.HOSTNAME || 'Unknown pod';

// Booleans
let healthy = true;
let hasFilesystem = fs.existsSync(directory);
let hasSecret = fs.existsSync(secretFile);
let hasConfigMap = fs.existsSync(configFile);


/*
  SETUP COMMON, SHARED VARIABLES
 */
app.locals.pod = pod;
app.locals.appVersion = appVersion;
app.locals.hasFilesystem = hasFilesystem;
app.locals.hasSecret = hasSecret;
app.locals.hasConfigMap = hasConfigMap;


/*
  DEBUGGING URLS
 */
app.get('/rip', function(request, response) {
  console.log('Rendering /rip for debugging');
  response.render('rip');
});

app.get('/error', function(request, response) {
  console.log('Rendering /error for debugging');
  response.render('error');
});


/*
  HOME URLS/FUNCTIONS
 */
app.get('/', function(request, response) {
  console.log('Redirecting to /home');
  response.redirect('home');
});

app.get('/home', function(request, response) {
  let status = healthStatus();
  response.render('home', {'healthStatus': status});
});

app.get('/health', function(request, response) {
  if( healthy ) {
    response.status(200);
  } else {
    response.status(500);
  }
  let status = healthStatus();
  response.send(status);
});

app.post('/health', function(request, response) {
  healthy = !healthy;
  console.log('Updating pod, ' + pod + ', health: ' + healthStatus());
  response.redirect('/home');
});

app.post('/log-stdout', function(request, response) {
  let msg = request.body.message || 'No message';
  console.log('stdout: ' + msg);
  response.redirect('/home');
});

app.post('/log-stderr', function(request, response) {
  let msg = request.body.message || 'No message';
  console.error('stderr: ' + msg);
  response.redirect('/home');
});

app.post('/crash', function(request, response) {
  let msg = request.body.message || 'No message';
  console.error('pod, ' + pod + ', crashing: ' + msg);

  // set up timer to crash after 2 seconds
  setTimeout( function() {
    process.nextTick(function() {
      throw new Error;
    });
  }, 2000 );

  // in the meantime render crash page
  response.render('rip', {'msg': msg});
});

function healthStatus() {
  if (healthy) {
    return "I'm feeling OK.";
  } else {
    return "I'm not feeling all that well.";
  }
}


/*
  FILESYSTEM URLS/FUNCTIONS
 */
if (hasFilesystem) {
  app.get('/filesystem', function(request, response) {
    fs.readdir(directory, function(err, items) {
      if (err) {
        console.error('error with persistent volume: ' + err);
        response.render('error', {'msg': JSON.stringify(err,null,4)});
      } else {
        if (!items) { items = []; }
        let index = request.query.filenameIndex;
        if (index !== undefined) {
          if (index < items.length) {
            fs.lstat(path.resolve(directory, items[index]), function(err, stats) {
              if (err) {
                console.error('error with persistent file: ' + items[index]);
                response.render('error', {'msg': JSON.stringify(err,null,4)});
              } else {
                if (stats.isFile()) {
                  fs.readFile(path.resolve(directory, items[index]), function (err, contents) {
                    if (err) {
                      console.error('unable to read persistent file: ' + items[index]);
                      response.render('error', {'msg': JSON.stringify(err, null, 4)});
                    } else {
                      console.log('rendering file contents for: ' + items[index]);
                      response.render('file', {'filename': items[index], 'file': contents});
                    }
                  });
                } else {
                  let displayMsg = 'Path (' + items[index] + ') is not a file. Please only attempt to read files.';
                  console.error(displayMsg);
                  response.render('filesystem', {'items': items, 'directory': directory, 'displayMsg': displayMsg});
                }
              }
            });
          } else {
            console.error('File not found.');
            response.render('filesystem', {'items': items, 'directory': directory, 'displayMsg': 'File not found.'});
          }
        } else {
          response.render('filesystem', {'items': items, 'directory': directory});
        }
      }
    });
  });

  app.post('/create-file', function(request, response){
    let filename = request.body.filename;
    if (validFilename(filename)){
      fs.writeFile(path.resolve(directory, filename), request.body.content, 'utf8', function (err) {
        if (err) {
          console.error('unable to create file: ' + filename);
          response.render('error', {'msg': JSON.stringify(err,null,4)});
        } else{
          console.log('created file: ' + filename);
          response.redirect('/filesystem');
        }
      });
    } else {
      fs.readdir(directory, function(err, items) {
        if (err) {
          console.error('error with persistent volume: ' + err);
          response.render('error', {'msg': JSON.stringify(err,null,4)});
        } else {
          let displayMsg = 'Invalid filename: "' + filename + '".';
          console.error(displayMsg);
          response.render('filesystem', {'items': items, 'directory': directory, 'displayMsg': displayMsg});
        }
      });
    }
  });
}


/*
  SECRETS URLS/FUNCTIONS
 */
if (hasSecret) {
  app.get('/secrets', function (request, response) {
    fs.readFile(secretFile, function (err, contents) {
      if (err) {
        console.error('secret not found');
        response.render('error', {'msg': JSON.stringify(err, null, 4)});
      } else {
        response.render('secrets', {'secret': contents});
      }
    });
  });
}


/*
  CONFIGMAPS URLS/FUNCTIONS
 */
if (hasConfigMap) {
  app.get('/configmaps', function (request, response) {
    fs.readFile(configFile, function (err, contents) {
      if (err) {
        console.error('configmap not found');
        response.render('error', {'msg': JSON.stringify(err, null, 4)});
      } else {
        response.render('config', {'config': contents});
      }
    });
  });
}

/*
  ENVIRONMENT VARIABLES URLS/FUNCTIONS
 */
app.get('/env-variables', function(request, response) {
  response.render('env-variables', {'envVariables': JSON.stringify(process.env,null,4)});
});


/*
  NETWORKING URLS/FUNCTIONS
 */
app.get('/network', function(request, response) {
  response.render('network');
});

app.get('/network/colors', function(request, response) {
  let options = {
        host: serviceIP,
        port: servicePort,
        path: '/',
        method: 'GET'
      },
      errMessage = 'microservice endpoint not available';

  http.request(options, function(httpResponse) {
    httpResponse.setEncoding('utf8');
    httpResponse.on('data', function (chunk) {
      console.log('msg from microservice: ' + chunk);
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(chunk);
    }).on('error', function () {
      console.error(errMessage);
      response.json(errMessage);
    });
  }).on('error', function () {
    console.error(errMessage);
    response.json(errMessage);
  }).end();
});

app.post('/network', function(request, response) {
  let dnsHostname = request.body.dnsHost;

  if (dnsHostname !== undefined) {
    console.log('DNS lookup on: ' + dnsHostname);
    processDNS(dnsHostname, response);
  } else {
    console.error('Empty form POSTED to /network');
    response.render('network', {'dnsResponse': 'Please provide a hostname', 'dnsHost': hostname});
  }
});

function processDNS(hostname, response) {
  dns.resolve4(hostname, function(err, addresses) {
    if (err) {
      response.render('network', {'dnsResponse': err, 'dnsHost': hostname});
    } else {
      let addrList = '';
      for (let i = 0; i < addresses.length; i++) {
        addrList += addresses[i] + '\n';
      }

      response.render('network', {'dnsResponse': addrList, 'dnsHost': hostname});
    }
  });
}


/*
  ABOUT URLS/FUNCTIONS
 */
app.get('/about', function(request, response) {
  response.render('about');
});


/*
  START SERVER
 */
console.log(`Version: ${appVersion}` );

app.listen(app.get('port'), '0.0.0.0', function() {
  console.log(pod + ': server starting on port ' + app.get('port'));
});
