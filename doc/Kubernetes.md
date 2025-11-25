# Getting Started (Kubernetes)
This repository includes the manifest files to simplify the deployment and testing of Redis in Kubernetes.
## **Prerequisites**  
Ensure you have the following installed:
- [Kubernetes Cluster](https://kubernetes.io/docs/setup/)
- [kubectl](https://kubernetes.io/es/docs/tasks/tools/)
- [Helm](https://helm.sh/docs/intro/quickstart/)
- [OpenSSL](https://www.openssl.org/)
## **Clone the repository**  
```sh
git clone https://github.com/mjguisado/speedis.git
cd speedis
```
## **Generate self signed certificate**
Generate self signed certificate to test HAProxy TLS termination.
```sh
./3rparties/haproxy/generate_self_signed_cert.sh
```
## **Deploy the resources**
1. Change to the K8S directory that contains the manifests:
```sh
cd k8s
```
2. Create the namespace:
```sh
kubectl apply -f speedis-namespace.yaml
```
3. Deploy the Redis Stack service:
```sh
kubectl apply -f ./redis-statefulset.yaml
kubectl apply -f ./redis-service.yaml
```
4. Deploy the Mock service:
```sh
kubectl apply -f ./mocks-deployment.yaml
kubectl apply -f ./mocks-service.yaml
```
5. Deploy Speedis service:
```sh
kubectl create configmap speedis-config  --from-file=../conf/speedis.json --namespace=speedis --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap speedis-origins --from-file=../conf/origins --namespace=speedis --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap speedis-certs --from-file=../conf/certs --namespace=speedis --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f ./speedis-deployment.yaml
kubectl apply -f ./speedis-service.yaml
```
6. Deploy the HAProxy Ingress Controller:
```sh
helm repo add haproxytech https://haproxytech.github.io/helm-charts
helm repo update
helm install haproxy-kubernetes-ingress haproxytech/kubernetes-ingress --create-namespace --namespace haproxy-controller 
```
7. Deploy the Ingress to access Speedis:
```sh
kubectl create secret tls mocks-tls-secret --cert=../3rparties/haproxy/certs/mocks.pem --key=../3rparties/haproxy/certs/mocks.pem --namespace=speedis --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f ./haproxy-ingress.yaml
```
After executing the previous steps, you can retrieve the details of the new service that has been created:
```sh
kubectl --namespace haproxy-controller get svc haproxy-kubernetes-ingress                            
```
Example output:
```
NAME                         TYPE       CLUSTER-IP      EXTERNAL-IP   PORT(S)                                                                  AGE
haproxy-kubernetes-ingress   NodePort   10.96.181.250   <none>        80:32307/TCP,443:32038/TCP,443:32038/UDP,1024:30904/TCP,6060:32026/TCP   3m51s
```
In this case, where the cluster was provided by Docker, the service is of type NodePort.
Hence, we need to enable access to it from outside the cluster using Port Forwarding.
8. Enable HTTPS access to the Speedis Service through the Ingress:
```sh
kubectl port-forward --namespace haproxy-controller svc/haproxy-kubernetes-ingress :443
```
Example output:
```
Forwarding from 127.0.0.1:51785 -> 8443
Forwarding from [::1]:51785 -> 8443
```
In our example, we didn’t specify a local port, so Kubernetes assigned port 51785.
To test the deployment, you can use the examples of request found in [./Requests.md](./Requests.md), adjusting the local port (51785 in this case) for HTTPS.

**HTTP Request to Speedis via HAProxy**
```sh
curl -vkXGET -H 'Host: mocks.localhost' 'https://127.0.0.1:51785/mocks/items/public-real-betis?delay=300&cc=public,max-age=10'
```