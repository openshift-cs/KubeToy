const express = require('express');
const bodyParser = require('body-parser');
const validFilename = require('valid-filename');
const fs = require('fs');
const ping = require('net-ping');
const { exec } = require('child_process');
const dns = require('dns');
const { uname } = require('node-uname');
const sysInfo = uname();
const sysInfoStr = `Arch: ${sysInfo.machine}, Release: ${sysInfo.release}`;
const appVersion = "1.0.0";

const configFile = "/var/config/config.json";
const secretFile = "/var/secret/demo-secret.txt";

let app = express();
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({
    extended: true
}));

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');


let pod = "xxxxx";
if( process.env.HOSTNAME ) {
    let hostname = process.env.HOSTNAME;
    index = hostname.lastIndexOf('-');
    pod = hostname.substring(index+1);
}


let healthy = true;
let mutated = false;
let logo = "OpenShiftDedicated.svg";

function healthStatus(){
    if( healthy ) {
        return "I'm feeling OK.";
    } else {
        return "I'm not feeling all that well.";
    }
}

let directory = '/var/test';
let filesystem = fs.existsSync(directory);

app.set('port', process.env.PORT || 8080);

if( filesystem ) {
    app.get('/files', function(req,res){
        fs.readdir(directory, function(err, items) {
            if( err ) {
                let pretty = JSON.stringify(err,null,4);
                console.error(pretty);
                res.render('error', { "pod": pod, "filesystem": filesystem, "msg": pretty });
            } else {
                if( !items ) {
                    items = [];
                }
                res.render('files', { "pod": pod, "items": items, "filesystem": filesystem, "directory": directory });
            }
        });
    });

    app.get('/show', function(req,res){
        let index = req.query.f;
        fs.readdir(directory, function(err, items) {
            if( index<items.length ) {
                res.sendFile( '/var/test/' + items[index] );
            } else {
                res.redirect('files');
            }
        });
    });

    app.post('/files', function(req,res){
        let filename = req.body.filename;
        if( validFilename( filename ) ){
            let content = req.body.content;
            console.log( 'creating file: ' + filename );

            fs.writeFile(directory + '/' + filename, content, 'utf8', function (err) {
                if (err) {
                    let pretty = JSON.stringify(err,null,4);
                    console.error(pretty);
                    res.render('error', { "pod": pod, "filesystem": filesystem, "msg": pretty });
                } else{
                    res.redirect('files');
                }
            });
        } else {
            let pretty ='Invalid filename: "' + filename + '"';
            console.error(pretty);
            res.render('error', { "pod": pod, "filesystem": filesystem, "msg": pretty });
        }
    });
}


app.get('/mutate', function(req,res){
    console.log("mutating");
    exec('echo "#\!/bin/bash\npwd" > ./mutate.sh');
    exec('chmod +x ./mutate.sh');
    exec('top &');
    if (mutated) {
        logo = "OpenShiftDedicated.svg";
    } else {
        logo = "OpenShiftDedicatedRed.svg";
    }
    mutated = !mutated;
    res.redirect('home');
});


app.post('/dns', function(req,res){
    let host = req.body.dnsHost;

    if( !host ) {
        let message = "Please provide a host name or IP";
        let args = {
            "pod": pod,
            "filesystem": filesystem,
            "pingResponse": "",
            "pingHost": "",
            "pingActive": "",
            "dnsResponse": message,
            "dnsHost": host,
            "dnsActive": "active"
        };

        res.render('network', args);
    } else {
        // ping options
        let options = {
            networkProtocol: ping.NetworkProtocol.IPv4,
            packetSize: 16,
            retries: 1,
            timeout: 2000,
            ttl: 128
        };

        dns.resolve4(host, function(err,addresses){
            if( err ) {
                let args = {
                    "pod": pod,
                    "filesystem": filesystem,
                    "pingResponse": "",
                    "pingHost": "",
                    "pingActive": "",
                    "dnsResponse": err,
                    "dnsHost": host,
                    "dnsActive": "active"
                };

                res.render('network', args);
            } else {
                console.log( addresses );
                let addrList = '';
                for(let i=0;i<addresses.length;i++){
                    if( i>1 ) {
                        addrList += '\n'+addresses[i];
                    } else {
                        addrList += addresses[i];
                    }
                }

                let args = {
                    "pod": pod,
                    "filesystem": filesystem,
                    "pingResponse": "",
                    "pingHost": "",
                    "pingActive": "",
                    "dnsResponse": addrList,
                    "dnsHost": host,
                    "dnsActive": "active"
                };
                res.render('network', args);
            }
        });
    }
});


app.post('/ping', function(req,res){
    let host = req.body.pingHost;

    if( !host ) {
        let message = "Please provide a host name or IP";
        let args = {
            "pod": pod,
            "filesystem": filesystem,
            "pingResponse": message,
            "pingHost": host,
            "pingActive": "active",
            "dnsResponse": "",
            "dnsHost": "",
            "dnsActive": ""
        };
        res.render('network', args);
    }

    // ping options
    let options = {
        networkProtocol: ping.NetworkProtocol.IPv4,
        packetSize: 16,
        retries: 1,
        timeout: 2000,
        ttl: 128
    };

    let session = ping.createSession(options);

    dns.resolve4(host, function(err,addresses){

        if( err ) {
            let args = {
                "pod": pod,
                "filesystem": filesystem,
                "pingResponse": err,
                "pingHost": host,
                "pingActive": "active",
                "dnsResponse": "",
                "dnsHost": "",
                "dnsActive": ""
            };
            res.render('network', args);
        } else {
            console.log( addresses );
            let ip = addresses[0];
            session.pingHost(ip, function(error, ip) {
                let message;
                if (error){
                    message = ip + ": " + error;
                }
                else {
                    message = ip + ": Alive";
                }
                let args = {
                    "pod": pod,
                    "filesystem": filesystem,
                    "pingResponse": message,
                    "pingHost": host,
                    "pingActive": "active",
                    "dnsResponse": "",
                    "dnsHost": "",
                    "dnsActive": ""
                };
                res.render('network', args);
            });
        }
    });
});


app.get('/network', function(req,res){
    let args = {
        "pod": pod,
        "filesystem": filesystem,
        "pingResponse": "",
        "pingHost": "",
        "pingActive": "",
        "dnsResponse": "",
        "dnsHost": "",
        "dnsActive": "active"
    };
    res.render('network', args);
});


app.get('/logit', function(req,res){
    let msg = req.query.msg;
    console.log(msg);
    res.redirect('home');
});

app.get('/errit', function(req,res){
    let msg = req.query.msg;
    console.error(msg);
    res.redirect('home');
});


function crash(msg, res){
    // write message to log
    if( !msg ) {
        msg = 'Aaaaah!';
    }
    console.error(pod + ': ' + msg);

    // set up timer to crash after 3 seconds
    setTimeout( function(){
        // process.exit(-1);  // produces simpler clear log entries than uncaught exception
        process.nextTick(function () {
            throw new Error;
        });
    }, 3000 );

    // in the meantime render crash page
    res.render('rip', {"pod": pod.substring(0,5), "msg": msg});
}

app.post('/crash', function(req,res){
    let msg = req.body.msg;
    if( !msg ) msg ="going down.";
    crash(msg, res);
});

app.get('/health', function(req, res){
    if( healthy ) {
        res.status(200);
    } else {
        res.status(500);
    }
    let status = healthStatus();
    res.send(status);
});

app.post('/health', function(req, res){
    healthy = !healthy;
    let status = healthStatus();
    console.log(pod + ': ' + status);
    res.redirect('home');
});

app.get('/config',
    function(req, res) {
        let config = "(file missing)";
        let secret = "(file missing)";

        if( fs.existsSync(configFile) ) {
            config = fs.readFileSync(configFile);
        }
        if( fs.existsSync(secretFile) ) {
            secret = fs.readFileSync(secretFile);
        }
        let prettyEnv = JSON.stringify(process.env,null,4);

        res.render('config', {"pod": pod, "pretty": prettyEnv, "filesystem": filesystem, "config": config, "secret": secret });
    }
);


app.get('/home',
    function(req, res) {
        let status = healthStatus();
        res.render('home', {"pod": pod, "logo": logo, "healthStatus": status, "filesystem": filesystem, "version": appVersion, "sysInfoStr": sysInfoStr });
    }
);

app.get('/version', function(req,res){
    res.status(200).send(appVersion);
});

app.get('/',
    function(req, res) {
        res.redirect('home');
    }
);

console.log(`Version: ${appVersion}` );
console.log(sysInfoStr);


app.listen(app.get('port'), '0.0.0.0', function() {
    console.log(pod + ": server starting on port " + app.get('port'));
});



	
