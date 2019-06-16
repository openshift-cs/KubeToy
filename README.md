# Shifty Demo
## v1.1.0

A simple Node.js application that deploys to OpenShift Dedicated. It is used to help 
explore the functionality of Kubernetes. This toy application has a user interface 
which you can:

* write messages to the log (stdout / stderr)
* intentionally crash the application to view auto repair
* toggle a liveness probe and monitor OpenShift behavior  
* if provided; read config maps, secrets, and env variables
* if connected to shared storage, read and write files
* check network connectivity, intra-cluster DNS, and intra-communication with an
  included microservice


# Deployment

## Using `oc` commands

```bash
# Add Secret to OpenShift
# The example emulates a `.env` file and shows how easy it is to move these directly into an
# OpenShift environment. Files can even be renamed in the Secret
$ oc create secret generic shifty-secret --from-file=secret.txt=deployment/examples/secret.env

secret "shifty-secret" created

# Add ConfigMap to OpenShift
# The example emulates an HAProxy config file, and is typically used for overriding
# default configurations in an OpenShift application. Files can even be renamed in the ConfigMap
$ oc create configmap shifty-config --from-file=config.json=deployment/examples/haproxy.config

configmap "shifty-config" created

# Deploy microservice
# We deploy the microservice first to ensure that the SERVICE environment variables
# will be available from the UI application. `--context-dir` is used here to only
# build the application defined in the `microservice` directory in the git repo.
# Using the `app` label allows us to ensure the UI application and microservice
# are both grouped in the OpenShift UI
$ oc new-app https://github.com/openshift-cs/shifty-demo \
    --context-dir=microservice \
    --name=shifty-microservice \
    --labels=app=shifty-demo

Creating resources with label app=shifty-demo ...
  imagestream "shifty-microservice" created
  buildconfig "shifty-microservice" created
  deploymentconfig "shifty-microservice" created
  service "shifty-microservice" created
Success
  Build scheduled, use 'oc logs -f bc/shifty-microservice' to track its progress.
  Application is not exposed. You can expose services to the outside world by executing one or more of the commands below:
   'oc expose svc/shifty-microservice'
  Run 'oc status' to view your app.
  
# Deploy the UI Application
# The applicaiton has been architected to rely on several environment variables to define
# external settings. We will attach the previously created Secret and ConfigMap afterward,
# along with creating a PersistentVolume
$ oc new-app https://github.com/openshift-cs/shifty-demo \
    --env=MICROSERVICE_NAME=SHIFTY_MICROSERVICE

Creating resources ...
  imagestream "shifty-demo" created
  buildconfig "shifty-demo" created
  deploymentconfig "shifty-demo" created
  service "shifty-demo" created
Success
  Build scheduled, use 'oc logs -f bc/shifty-demo' to track its progress.
  Application is not exposed. You can expose services to the outside world by executing one or more of the commands below:
   'oc expose svc/shifty-demo'
  Run 'oc status' to view your app.
  
# Update Deployment to use a "Recreate" deployment strategy for consistent deployments
# with persistent volumes
$ oc patch dc/shifty-demo -p '{"spec": {"strategy": {"type": "Recreate"}}}'

deploymentconfig "shifty-demo" patched

# Set a Liveness probe on the Deployment to ensure the pod is restarted if something
# isn't healthy within the application
$ oc set probe dc/shifty-demo --liveness --get-url=http://:8080/health

deploymentconfig "shifty-demo" updated

# Attach Secret, ConfigMap, and PersistentVolume to deployment
# We are using the default paths defined in the application, but these paths
# can be overriden in the application via environment variables
# Attach Secret
$ oc set volume deploymentconfig shifty-demo --add \
    --secret-name=shifty-secret \
    --mount-path=/var/secret

info: Generated volume name: volume-6fqmv
deploymentconfig "shifty-demo" updated

# Attach ConfigMap (using shorthand commands)
$ oc set volume dc shifty-demo --add \
    --configmap-name=shifty-config \
    -m /var/config

info: Generated volume name: volume-2ct8f
deploymentconfig "shifty-demo" updated

# Create and attach PersistentVolume
$ oc set volume dc shifty-demo --add \
    --type=pvc \
    --claim-size=1G \
    -m /var/demo_files

info: Generated volume name: volume-rlbvv
persistentvolumeclaims/pvc-gbpx7
deploymentconfig "shifty-demo" updated

# Finally expose the UI application as an OpenShift Route
# Using OpenShift Dedicated's included TLS wildcard certicates, we can easily
# deploy this as an HTTPS application
$ oc create route edge --service=shifty-demo --insecure-policy=Redirect

route "shifty-demo" created

# Browse to your application!
$ python -m webbrowser "$(oc get route shifty-demo -o template --template='https://{{.spec.host}}')"
```


### Changes from KubeToy

* Remove IBM CoS integration
* Remove references to IBM Private Cloud
* Include OpenShift specific styles and logos
* Remove unused packages and misc clean up
* Redesigned with [PatternFly](https://www.patternfly.org/)
* Rearchitected in a cleaner format
* Include intra-cluster communication from Networking page
  * Adds a separate `microservice` sub-deployment