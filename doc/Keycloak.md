# Grafana dashboard
The project incorporates Keycloak, an Identity and Access Management (IAM) server, is included to support OAuth2 integration within Speedis.
In the sample mocks configuration, Keycloak is used, and it must be properly configured before running Speedis.
Below are the steps to configure it.
If you want to learn more about concepts such as Realm, Client, and others, you can refer to the [Keycloak documentation](https://www.keycloak.org/documentation)

1. **Access Keycloak at https://keycloak.localhost:8443 (User: admin, Password: admin).**

<img src="./img/keycloak_login.png"/>

2. **Create the Speedis Realm.**

In the left-hand menu, click on “Manage realms”, then click the “Create realm” button.
<img src="./img/keycloak_create_realm.png"/>
Enter the name of the realm (it must be speedis) and click Create.
<img src="./img/keycloak_setup_realm.png"/>
Once created, the new realm will appear in the list of realms.
<img src="./img/keycloak_realm_created.png"/>

3. **Import the client configuration.**

**Make sure that speedis is shown at the top of the left menu as the current realm.**

In the left-hand menu, click on “Clients”, then click the “Import client” link.
<img src="./img/keycloak_list_clients.png"/>
Upload the contents of the ./3rparties/keycloak/speedis-client.json file into the Resource file field and click Save.
<img src="./img/keycloak_import_client.png"/>
Once created, the new realm will appear in the list of clients.

4. **Create an user.**

**Make sure that speedis is shown at the top of the left menu as the current realm.**

In the left-hand menu, click “Users”, then click the “Create new user” button.
<img src="./img/keycloak_list_users.png"/>
Enter the user details and click Create.
<img src="./img/keycloak_create_user.png"/>
Once the user has been created, open the “Credentials” tab and click “Set Password”.
<img src="./img/keycloak_list_credentials.png"/>
Enter the new password for the user.
<img src="./img/keycloak_set_password.png"/>
Confirm the operation.
<img src="./img/keycloak_confirm_password.png"/>
The new password should now appear in the user’s list of credentials.
<img src="./img/keycloak_password_created.png"/>
