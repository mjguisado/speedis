import jp from 'jsonpath'

export function deleteJsonPaths(target, params) {
    let body = null;
    try {
        body = JSON.parse(target.body)
    } catch (error) {
        console.error(`Error parsing JSON: ${error.message}`);
        return;
    }
    if (Object.prototype.hasOwnProperty.call(params, 'jsonpaths')) {
        params.jsonpaths.forEach(path => {
            try {
                jp.paths(body, path).forEach(p => {
                    let ref = body;
                    for (let i = 1; i < p.length - 1; i++) {
                        ref = ref[p[i]];
                        if (!ref) return;
                    }
                    delete ref[p[p.length - 1]];
                })
            } catch (error) {
                console.error(`Error deleting JSON elements: ${error.message}`);                
            }
        })
    }
    if (body) target.body = JSON.stringify(body)
}

export function keepJsonPaths(target, params) {
    let result = {};
    let body = null;
    try {
        body = JSON.parse(target.body)
    } catch (error) {
        console.error(`Error parsing JSON: ${error.message}`);
        return;
    }
    if (Object.prototype.hasOwnProperty.call(params, 'jsonpaths')) {
        params.jsonpaths.forEach(path => {
            try {
                jp.paths(body, path).forEach(p => {
                    let value = jp.value(body, jp.stringify(p));
                    let ref = result;
                    let pathArray = p.slice(1)
                    for (let i = 0; i < pathArray.length - 1; i++) {
                        ref = ref[pathArray[i]] = ref[pathArray[i]] || {};
                    }
                    ref[pathArray[pathArray.length - 1]] = value;
                })
            } catch (error) {
                console.error(`Error keeping JSON elements: ${error.message}`);                
            }
        })
    }
    target.body = JSON.stringify(result)
}