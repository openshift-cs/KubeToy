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
const { BlobServiceClient } = require("@azure/storage-blob");
const appVersion = '1.7.0';

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
let azureConnectionStringFile = process.env.AZURE_CONNECTION_STRING_LOCATION || '/mnt/secrets-store/connectionsecret';

if (!path.isAbsolute(configFile)) { configFile = path.resolve(__dirname, configFile); }
if (!path.isAbsolute(secretFile)) { secretFile = path.resolve(__dirname, secretFile); }
if (!path.isAbsolute(directory)) { directory = path.resolve(__dirname, directory); }

let pod = process.env.HOSTNAME || 'Unknown pod'; // Pod name
let ns = process.env.NAMESPACE; //Namespace

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
app.locals.isAzure = undefined; //use this for automated checking if this is on azure

//AZURE RELATED VARIABLES
let connectionString = undefined; //the connection string to the Azure Storage Account
let blobServiceClient = undefined;
let containerClient = undefined;

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
    console.error('ACK can only be accessed on AWS.');
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
    console.error('ACK can only be accessed on AWS.');
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
        response.render('viewcontents', {'filename': filename, 'content': data.Body});
      }
    });
  }
});

//create an object in the s3 bucket
app.post('/s3upload', function(request, response) {
  if (!app.locals.isAWS) {
    console.error('ACK can only be accessed on AWS.');
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
  AZURE SERVICE OPERATOR

  This is for the section of the workshop to demonstrate the ASO.  This section supports the reading and writing of blobs
  to the Blob Storage account.  The set up of the storage "clients" is done in the checkIfAzure() method further below.
*/

//Get list of blob names in the container
app.get('/aso', async (request, response) => {
  if (!app.locals.isAzure) {
    console.error('ASO can only be used with Azure.');
    response.render('error', {'msg': 'In order to use the ASO feature this must be run on Azure.'});
  } else {
    const blobs = containerClient.listBlobsFlat();
    const blobNames = [];

    for await (const blob of blobs) {
      blobNames.push(blob.name);
    }
    response.render('aso', { 'blobnames': blobNames, 'containername': ns + "-container" });
  }
});

//View the contents of a blob file
app.get('/viewblob/:blobName', async (request, response) => {
  if (!app.locals.isAzure) {
    console.error('ASO can only be used with Azure.');
    response.render('error', {'msg': 'In order to use the ASO feature this must be run on Azure.'});
  } else {
    const blobName = request.params.blobName;

    try {
      const blobClient = containerClient.getBlobClient(blobName);
      const downloadBlockBlobResponse = await blobClient.download();
      const blobContents = await streamToString(downloadBlockBlobResponse.readableStreamBody);
      response.render('viewcontents', {'filename': blobName, 'content': blobContents});
    } catch (error) {
        if (error.statusCode === 404 && error.code === "BlobNotFound") {
          console.log("Blob not found");
          response.render('error', {'msg': blobName + ' not found.'});
        } else {
          console.error('An error occurred: ' + error.message);
          response.render('error', {'msg': error.message});
        }
    }
  }
});

//Upload or create a new text blob
app.post('/createblob', async (request, response) => {
  if (!app.locals.isAzure) {
    console.error('ASO can only be used with Azure.');
    response.render('error', {'msg': 'In order to use the ASO feature this must be run on Azure.'});
  } else {
    let filename = request.body.filename;
    let content = request.body.content;

    try {
      const blockBlobClient = containerClient.getBlockBlobClient(filename);
      const uploadResult = await blockBlobClient.upload(content, content.length);
      console.log('Blob ' + filename + ' has been created.');
      response.redirect('/aso');
    } catch (error) {
      console.error('Error uploading file ' + filename + ' to blob storage: ' + error.message);
      response.render('error', {'msg': 'Error uploading file: ' + error.message});
    }
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

async function streamToString(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => {
      chunks.push(data.toString());
    });
    readableStream.on('end', () => {
      resolve(chunks.join(''));
    });
    readableStream.on('error', reject);
  });
}

//The following function is used to check if this app is running on Azure and has a valid container accessible.
//If it is it also sets up the clients.
async function checkIfAzure() {

  //check if the connectionString secret is mounted to the location in the pod
  if (fs.existsSync(azureConnectionStringFile)) {
    console.log('Connection string secret file exists');
    connectionString = fs.readFileSync(azureConnectionStringFile, 'utf8');
  } else {
    console.log('Connection string secret file does not exist or is not readable.');
  }

  if (connectionString === undefined){
    app.locals.isAzure = false;
    console.log("ASO feature disabled. Connection string not found.");
  } else {
    try{
      blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      containerClient = blobServiceClient.getContainerClient(ns + "-container");

      const exists = await containerClient.exists();

      if (exists) {
        app.locals.isAzure = true;
        console.log("ASO feature enabled.");
      } else {
        app.locals.isAzure = false;
        console.log("ASO feature disabled. " + ns + "-container not found.");
      }
    } catch (error) {
      app.locals.isAzure = false;
      console.log("ASO feature disabled. Error: " + error.message);
    }
  }
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

//the first time the app is run isAWS will be undefined thus requiring a check
//of if the app can access the S3 bucket
if (app.locals.isAWS === undefined){
  // Create S3 service object
  s3 = new AWS.S3({apiVersion: '2006-03-01'});

  var bucketParams = {
    Bucket : ns + "-bucket",  //the bucket name will be "<namespace>-bucket"
  };

  s3.headBucket(bucketParams, function(err,data){
    if (err) { //there was some error in accessing the bucket, or it does not exist -> don't show ACK menu item
      console.log("ACK feature disabled. " + ns + "-bucket not found.");
      app.locals.isAWS = false;

      //Then check if it is running on Azure, and if so set it up.
      checkIfAzure();
    } else { //show the ack feature
      console.log("Bucket accessible, enabling ACK feature.");
      app.locals.isAWS = true;
      app.locals.isAzure = false;
    }
  });

} 


app.listen(app.get('port'), '0.0.0.0', function() {
  console.log(pod + ': server starting on port ' + app.get('port'));
});
