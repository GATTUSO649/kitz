# Maps and delivery status

GPS selection, geocoding, route calculation, delivery quoting, and rider tracking are not implemented. Delivery zones exist only as a database table in the current schema. No dispatch address, coordinates, fee, API key, or customer location is assumed.

Choose Google Maps Platform or an OpenStreetMap-based stack before implementation. Keep provider keys restricted and server-side where possible. Calculate road distance and delivery charges on the backend, allow manual address entry when GPS is denied, and restrict customer coordinates to authorized order/delivery workflows.