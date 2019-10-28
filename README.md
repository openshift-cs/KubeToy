# OSToy
## v1.3

A simple Node.js application that deploys to OpenShift. It is used to help
explore the functionality of Kubernetes. This toy application has a user interface
which you can:

* write messages to the log (stdout / stderr)
* intentionally crash the application to view auto repair
* toggle a liveness probe and monitor OpenShift behavior
* if provided; read config maps, secrets, and env variables
* if connected to shared storage, read and write files
* check network connectivity, intra-cluster DNS, and intra-communication with an
  included microservice
* increase the load to test out Horizontal Pod Autoscaler


# Configuration
## Environment Variables

- **PORT** (*default: 8080*): The port to expose the application on
- **MICROSERVICE_NAME** (*default: none*): The upper-cased name of the Service object associated
with the microservice application (be sure to also replace any `-` with `_`)
- **MICROSERVICE_IP** (*default: <MICROSERVICE_NAME>\_SERVICE\_HOST*): The static IP of the Service
object associated with the microservice application. This will be looked up from automatic OpenShift
environment variables if `MICROSERVICE_NAME` is provided
- **MICROSERVICE_PORT** (*default: <MICROSERVICE_NAME>\_SERVICE\_PORT*): The exposed port of the Service
object associated with the microservice application. This will be looked up from automatic OpenShift
environment variables if `MICROSERVICE_NAME` is provided
- **CONFIG_FILE** (*default: /var/config/config.json*): The fully-qualified path to the file created by
the ConfigMap object
- **SECRET_FILE** (*default: /var/secret/secret.txt*): The fully-qualified path to the file created by
the Secret object
- **PERSISTENT_DIRECTORY** (*default: /var/demo\_files*): The fully-qualified path to the directory mounted
with the PersistentVolume


# Deployment

## Using `oc` commands

```bash
# Add Secret to OpenShift
# The example emulates a `.env` file and shows how easy it is to move these directly into an
# OpenShift environment. Files can even be renamed in the Secret
$ oc create -f https://raw.githubusercontent.com/openshift-cs/ostoy/master/deployment/yaml/secret.yaml

secret "ostoy-secret" created

# Add ConfigMap to OpenShift
# The example emulates an HAProxy config file, and is typically used for overriding
# default configurations in an OpenShift application. Files can even be renamed in the ConfigMap
$ oc create -f https://raw.githubusercontent.com/openshift-cs/ostoy/master/deployment/yaml/configmap.yaml

configmap "ostoy-config" created

# Deploy microservice
# We deploy the microservice first to ensure that the SERVICE environment variables
# will be available from the UI application. `--context-dir` is used here to only
# build the application defined in the `microservice` directory in the git repo.
# Using the `app` label allows us to ensure the UI application and microservice
# are both grouped in the OpenShift UI
$ oc new-app https://github.com/openshift-cs/ostoy \
    --context-dir=microservice \
    --name=ostoy-microservice \
    --labels=app=ostoy

Creating resources with label app=ostoy ...
  imagestream "ostoy-microservice" created
  buildconfig "ostoy-microservice" created
  deploymentconfig "ostoy-microservice" created
  service "ostoy-microservice" created
Success
  Build scheduled, use 'oc logs -f bc/ostoy-microservice' to track its progress.
  Application is not exposed. You can expose services to the outside world by executing one or more of the commands below:
   'oc expose svc/ostoy-microservice'
  Run 'oc status' to view your app.

# Deploy the UI Application
# The applicaiton has been architected to rely on several environment variables to define
# external settings. We will attach the previously created Secret and ConfigMap afterward,
# along with creating a PersistentVolume
$ oc new-app https://github.com/openshift-cs/ostoy \
    --env=MICROSERVICE_NAME=OSTOY_MICROSERVICE

Creating resources ...
  imagestream "ostoy" created
  buildconfig "ostoy" created
  deploymentconfig "ostoy" created
  service "ostoy" created
Success
  Build scheduled, use 'oc logs -f bc/ostoy' to track its progress.
  Application is not exposed. You can expose services to the outside world by executing one or more of the commands below:
   'oc expose svc/ostoy'
  Run 'oc status' to view your app.

# Update Deployment to use a "Recreate" deployment strategy for consistent deployments
# with persistent volumes
$ oc patch dc/ostoy -p '{"spec": {"strategy": {"type": "Recreate"}}}'

deploymentconfig "ostoy" patched

# Set a Liveness probe on the Deployment to ensure the pod is restarted if something
# isn't healthy within the application
$ oc set probe dc/ostoy --liveness --get-url=http://:8080/health

deploymentconfig "ostoy" updated

# Attach Secret, ConfigMap, and PersistentVolume to deployment
# We are using the default paths defined in the application, but these paths
# can be overriden in the application via environment variables
# Attach Secret
$ oc set volume deploymentconfig ostoy --add \
    --secret-name=ostoy-secret \
    --mount-path=/var/secret

info: Generated volume name: volume-6fqmv
deploymentconfig "ostoy" updated

# Attach ConfigMap (using shorthand commands)
$ oc set volume dc ostoy --add \
    --configmap-name=ostoy-config \
    -m /var/config

info: Generated volume name: volume-2ct8f
deploymentconfig "ostoy" updated

# Create and attach PersistentVolume
$ oc set volume dc ostoy --add \
    --type=pvc \
    --claim-size=1G \
    -m /var/demo_files

info: Generated volume name: volume-rlbvv
persistentvolumeclaims/pvc-gbpx7
deploymentconfig "ostoy" updated

# Finally expose the UI application as an OpenShift Route
# Using OpenShift Dedicated's included TLS wildcard certicates, we can easily
# deploy this as an HTTPS application
$ oc create route edge --service=ostoy --insecure-policy=Redirect

route "ostoy" created

# Browse to your application!
$ python -m webbrowser "$(oc get route ostoy -o template --template='https://{{.spec.host}}')"
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
* Add function to increase load to test HPA
