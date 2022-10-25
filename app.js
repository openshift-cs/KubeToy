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
const AWS = require('aws-sdk');
const appVersion = '1.5.0';

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

//Namespace
let ns = process.env.NAMESPACE;

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
app.locals.isAWS = undefined; //use this for automated checking

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


/*
  OTHER URLS/FUNCTIONS
 */
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
  //redact AWS IAM ARN account numbers and role name
  let envdata = JSON.stringify(process.env,null,4);
  let envvar = envdata.replace(/\d{9}:role\/.*/,'*********:role/<redacted>\"\,');

  response.render('env-variables', {'envVariables': envvar});
});

/*
  AWS CONTROLLER FOR KUBERNETES

  There are 3 capabilities below:
  1. Show the contents of the bucket (which is of a predetermined syntax of "<namespace>-bucket")
  2. Get the contents of a specific object (file) in the bucket
  3. Create a new object(file) in the bucket

  For Authentication (taken from: https://aws-controllers-k8s.github.io/community/docs/user-docs/authentication/#background)
  ------------
  When initiating communication with an AWS service API, the ACK controller creates a new aws-sdk-go Session object. This Session
  object is automatically configured during construction by code in the aws-sdk-go library that looks for credential information
  in the following places, in this specific order:

  1. If the AWS_PROFILE environment variable is set, find that specified profile in the configured credentials file and use that profile’s credentials.
  2. If the AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables are both set, these values are used by aws-sdk-go to set the AWS credentials.
  3. If the AWS_WEB_IDENTITY_TOKEN_FILE environment variable is set, `aws-sdk-go` will load the credentials from the JSON web token (JWT) present in the file
    pointed to by this environment variable. Note that this environment variable is set to the value `/var/run/secrets/eks.amazonaws.com/serviceaccount/token`
    by the IAM Roles for Service Accounts (IRSA) pod identity webhook and the contents of this file are automatically rotated by the webhook with temporary credentials.
  4. If there is a credentials file present at the location specified in the AWS_SHARED_CREDENTIALS_FILE environment variable (or $HOME/.aws/credentials if empty),
    `aws-sdk-go` will load the “default” profile present in the credentials file.
*/

//returns the object keys (names) that are in the bucket
app.get('/ack', function(request, response) {
  if (!app.locals.isAWS) {
    console.error("ACK can only be accessed on AWS.");
    response.render('error', {'msg': 'In order to use the ACK this must be run on AWS.'});
  } else {
    // Create S3 service object
    s3 = new AWS.S3({apiVersion: '2006-03-01'});

    var bucketParams = {
      Bucket : ns + "-bucket",  //the bucket name will be "<namespace>-bucket"
      MaxKeys: 10
    };

    s3.listObjects(bucketParams, function(err, data){
      if (err) {
        console.error(err + "\nAttepting access to bucket: " + ns + "-bucket");
        response.render('error', {'msg': JSON.stringify(err, null, 4) + "\nAttepting access to bucket: " + ns + "-bucket"});
      } else {
        response.render('ack', {'s3Objects': data.Contents, 'bucketname': data.Name});
      }
    });
  }
});

//Get the selected object from the S3 bucket and render to the browser
app.get('/getFile', function(request, response) {
  if (!app.locals.isAWS) {
    console.error("ACK can only be accessed on AWS.");
    response.render('error', {'msg': 'In order to use the ACK this must be run on AWS.'});
  } else {

    let filename = request.query.filename;

    //Create S3 service object
    s3 = new AWS.S3({apiVersion: '2006-03-01'});

    var bucketParams = {
      Bucket : ns + "-bucket",  //the bucket name will be "<namespace>-bucket"
      Key: filename
    };

    s3.getObject(bucketParams, function(err, data){
      if (err) {
        console.error(err);
        response.render('error', {'msg': JSON.stringify(err, null, 4)});
      } else {
        response.render('s3viewfile', {'filename': filename, 'content': data.Body});
      }
    });
  }
});

//create an object in the s3 bucket
app.post('/s3upload', function(request, response) {
  if (!app.locals.isAWS) {
    console.error("ACK can only be accessed on AWS.");
    response.render('error', {'msg': 'Wrong cloud platform. In order to use the ACK this must be run on AWS.'});
  } else {
    let filename = request.body.filename;
    let content = request.body.content;

    // Create S3 service object
    s3 = new AWS.S3({apiVersion: '2006-03-01'});

    var bucketParams = {
      Bucket : ns + "-bucket",  //the bucket name will be "<namespace>-bucket"
      Body: content,
      Key: filename,
      ContentType: 'text/plain'
    };

    s3.putObject(bucketParams, function(err, data) {
      if (err) {
        console.error(err);
        response.render('error', {'msg': JSON.stringify(err, null, 4)});
      } else {
        response.redirect('/ack');
      }
    });
  }
});

/*
  Horizontal Pod Autoscaler URLS/FUNCTIONS.
 */

app.get('/autoscaling', function(request, response) {
  response.render('autoscaling');
});

app.get('/hpa', function(request, response) {
  let options = {
      host: serviceIP,
      port: servicePort,
      path: '/hpa',
      method: 'GET'
    },
    errMessage = 'microservice endpoint not available';

  http.request(options, function(httpResponse) {
      return;
  }).on('error', function () {
    console.error(errMessage);
    response.json(errMessage);
  }).end();

  response.writeHead(200);
  response.end('done');
});

/*
  NETWORKING URLS/FUNCTIONS.
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

//the first time the app is run this will be set to false thus requiring a check
//of if the app can access the S3 bucket
if (app.locals.isAWS === undefined){
  // Create S3 service object
  s3 = new AWS.S3({apiVersion: '2006-03-01'});

  var bucketParams = {
    Bucket : ns + "-bucket",  //the bucket name will be "<namespace>-bucket"
  };

  s3.headBucket(bucketParams, function(err,data){
    if (err) { //there was some error in accessing the bucket, or it does not exist -> don't show ACK menu item
      let msg = "If this is not running on AWS and/or you have no intention of using the ACK please ignore. \n" +
                   " - Error in accessing the " + ns + "-bucket, or it does not exist. \n" +
                   " - ACK feature disabled";
      console.log(msg);
      app.locals.isAWS = false;
    } else { //show the ack feature
      console.log("Bucket accessible, enabling ACK feature.");
      app.locals.isAWS = true;
    }
  });
}

app.listen(app.get('port'), '0.0.0.0', function() {
  console.log(pod + ': server starting on port ' + app.get('port'));
});
