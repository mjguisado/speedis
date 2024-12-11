// Use this file only as a guide for first steps using routes. Delete it when you have added your own route files.
// For a detailed explanation regarding each routes property, visit:
// https://mocks-server.org/docs/usage/routes

// items data
import items from '../fixtures/items .js'

export default [
  {
    id: "get-items",
    url: "/items",
    method: "GET",
    variants: [
      {
        id: "success",
        type: "json",
        options: {
          status: 200, 
          body: items
        }
      },
      {
        id: "success-slow",
        type: "json",
        delay: 5000,
        options: {
          status: 200,
          body: items
        }
      },
    ]
  },
  {
    id: "get-item",
    url: "/items/:id",
    method: "GET",
    variants: [
      {
        id: "success",
        type: "middleware",
        options: {
          middleware: (req, res) => {
            const itemId = req.params.id;
            const item = items.find((itemData) => itemData.id === Number(itemId));
            if (item) {
              res.status(200);
              res.send(item);
            } else {
              res.status(404);
              res.send({
                message: "Item not found",
              })
            }
          }
        }
      }
    ]
  }
]
