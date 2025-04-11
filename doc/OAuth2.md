# Introduction to OAuth2: Securing API Access

In the traditional client-server authentication model, the client application requests an access-restricted resource (protected resource) from the resource server by authenticating using the resource owner’s credentials. To grant third-party applications access to these protected resources, the Resource Owner must share their credentials with them. This approach introduces several security risks and limitations.

To address these issues, [OAuth2](https://www.rfc-editor.org/rfc/rfc6749)—a widely adopted authorization framework—provides a secure mechanism for granting limited access to protected resources without exposing the Resource Owner’s credentials to third-party applications.

Instead of sharing credentials, OAuth2 introduces the concept of an Authorization Server. This server issues access tokens after validating the Resource Owner’s identity and the requested permissions (known as scopes). The protected Resource Server only accepts requests that include a valid access token, which is short-lived by design to reduce the risk of misuse if compromised.

Before moving forward, it is important to clarify several roles and concepts defined by OAuth2, as they may have different meanings in other contexts.

OAuth2 defines four [roles](https://www.rfc-editor.org/rfc/rfc6749#section-1.1):
1. **Resource Owner**: An entity capable of granting or denying access to a protected resource. When the resource owner is a person, it is referred to as an **end-user**.
2. **Resource Server**: The server hosting the protected resources, capable of accepting and responding to protected resource requests using access tokens.
3. **Client**: An application making protected resource requests on behalf of the resource owner and with its authorization.
4. **Authorization Server**: The server issuing access tokens to the client after successfully authenticating the resource owner and obtaining authorization.
OAuth2 defines two [client types](https://www.rfc-editor.org/rfc/rfc6749#section-2.1), based on their ability to authenticate securely with the Authorization Server:
1. **Confidential**: Clients capable of maintaining the confidentiality of their credentials.
2. **Public**: Clients incapable of maintaining the confidentiality of their credentials.

Frontend applications that run on the Resource Owner’s device operate in environments where end-users can potentially access or extract sensitive information. As a result, client secrets are considered compromised by design, and these applications are classified as Public Clients. Examples of Public Clients include user-agent-based applications, where the client code is retrieved from a web server and executed within a user agent (e.g., a web browser) on the Resource Owner’s device, and native applications, which are installed and run directly on the Resource Owner’s device.

It’s important to note that upon receiving the access token, the Client must store it securely to prevent exposure to malicious actors. Storing tokens on Public Clients introduces significant security risks, especially when tokens are accessible via JavaScript, as this makes them vulnerable to Cross-Site Scripting (XSS) attacks.

To mitigate these risks, best practices recommend moving the Client role to a backend component, where it can securely manage and store sensitive information such as Client credentials and tokens. By doing so, the Client can be classified as a confidential Client. In this architecture, the term User-Agent refers to the frontend application—typically a web browser or mobile app—through which the user interacts with the Client.

OAuth2 defines four [grant types](https://www.rfc-editor.org/rfc/rfc6749#section-1.3), also called “authorization flows”: Authorization Code, Resource Owner Password Credentials, Implicit & Client Credentials. One of the most secure is the [Authorization Code](https://www.rfc-editor.org/rfc/rfc6749#section-1.3.1), often used in web and mobile applications because it is designed to ensure that tokens are never exposed to them, minimizing the risk of token theft.

During the process of [obtaining authorization in the Authorization Code flow](https://www.rfc-editor.org/rfc/rfc6749#section-4.1), it is crucial to note that while the User-Agent (i.e., the browser or mobile app) is responsible for redirecting the user to the Authorization Server for authentication and consent, it does not function as the Client in OAuth2 terms. The User-Agent merely facilitates the user’s interaction with the Client, which is represented by a backend component.

In this architecture, the User-Agent receives an identifier that corresponds to the user’s session, which is managed by the Client. A common approach for web applications is to use secure, HTTP-only cookies to store this session ID. By setting the cookie as HTTP-only, the browser ensures that JavaScript cannot access it, making it immune to XSS attacks. Furthermore, marking the cookie as Secure ensures that it is only transmitted over HTTPS, providing an additional layer of protection.

When the User-Agent needs to access protected resources, it sends the session ID in an HTTP request, typically as a cookie or within the Authorization header. The Client then retrieves the corresponding [access token](https://www.rfc-editor.org/rfc/rfc6749#section-1.4) (and [refresh token](https://www.rfc-editor.org/rfc/rfc6749#section-1.5), if applicable) from a secure store. To ensure high performance, in-memory databases such as [Redis](https://redis.io/) are commonly used as secure storage for tokens.

This method of token exchange enables the User-Agent to avoid handling sensitive information directly, while the backend assumes responsibility for managing and securing access tokens.

As previously mentioned, OAuth2 utilizes refresh tokens to allow Clients to obtain new access tokens without requiring the user to reauthenticate. Refresh tokens are long-lived credentials securely stored on the Client and are typically used when an access token expires. When this occurs, the Client can send the refresh token to the Authorization Server to request a new access token. This process ensures that the user session persists without requiring frequent logins, improving the user experience while maintaining security.

Thus, the Client is responsible for managing token expiration, renewal, and revocation, ensuring that users remain authenticated as long as necessary and preventing unauthorized access once the token expires.
