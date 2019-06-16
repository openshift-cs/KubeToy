# Shifty Demo
## v1.1.0

A simple Node.js application that deploys to OpenShift Dedicated. It is used to help 
explore the functionality of Kubernetes. This toy application has a user interface 
which you can:

* write messages to the log (stdout / stderr)
* intentionally crash the application to view auto repair
* toggle a liveness probe and monitor kuberenetes behavior  
* read config maps and secrets from environment vars and files
* if connected to shared storage, read and write files

**[Playing with the logs](documentation/Logs.md)** 
Use the app to write to the logs, then view the logs in the UI and via Kibana.

**[Crash the app](documentation/Crash.md)**
Intentionally crash the application and watch it self heal.

**[ConfigMaps and Secrets](documentation/Config.md)** Explore configuration options for apps deployed to OSD.

**[Shared Filesystem](documentation/Filesystem.md)** Use the shared files system to store and read content across all instances of the application. File information is persisted even if the app crashes.

**[Network](documentation/Network.md)** Ping and do DNS lookups from the server side app. You can verify visibility of related ClusterIP services.

**[Ingress](documentation/Ingress.md)** Show how you can, with the help of nginx you can set up an ingress for this app, with your own custom certs providing SSL protection.


# Changes from KubeToy

* Remove IBM CoS integration
* Remove references to IBM Private Cloud
* Include OpenShift specific styles and logos
* Remove unused packages and misc clean up
* Redesigned with [PatternFly](https://www.patternfly.org/)
* Rearchitected in a cleaner format
* Include intra-cluster communication from Networking page
  * Adds a separate `microservice` sub-deployment