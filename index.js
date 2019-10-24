const iconv = require('iconv-lite');
/*

type TemplateTag = {
  name: string,
  displayName: DisplayName,
  disablePreview?: () => boolean,
  description?: string,
  deprecated?: boolean,
  validate?: (value: any) => ?string,
  priority?: number,
  args: Array<{
    displayName: string,
    description?: string,
    defaultValue: string | number | boolean,
    type: 'string' | 'number' | 'enum' | 'model',

    // Only type === 'string'
    placeholder?: string,

    // Only type === 'model'
    modelType: string,

    // Only type === 'enum'
    options: Array<{
      displayName: string,
      value: string,
      description?: string,
      placeholder?: string,
    }>,
  }>,
};

 */
module.exports.templateTags = [
  {
    name: 'ResponseEval',
    displayName: 'Response Eval',
    description: "reference values from other request's responses and then run JS on the output.",
    args: [
      {
        displayName: 'Attribute',
        type: 'enum',
        options: [
          {
            displayName: 'Raw Body',
            description: 'entire response body',
            value: 'raw'
          },
          {
            displayName: 'Header',
            description: 'value of response header',
            value: 'header'
          }
        ]
      },
      {
        displayName: 'Request',
        type: 'model',
        model: 'Request'
      },
      {
        type: 'string',
        hide: args => args[0].value !== 'header',
        defaultValue: '',
        displayName: 'Header Name'
      },
      {
        type: 'string',
        defaultValue: '',
        displayName: 'Prefilter',
        description: 'Pre filter the output. If the output is an array, filter the items by this value (string: indexOf, regex: match(with tokens being returned as the output if they exist)'
      },
      {
        type: 'string',
        displayName: 'JavaScript Code',
        description: 'The variable named `output` contains the output of the original response template tag.',
        placeholder: 'output'
      }
    ],

    async run(context, field, id, filter, prefilter, js) {
      filter = field === 'raw' ? '' : filter || '';
      prefilter = prefilter || '';

      const sanitizedSubFilter = sanitizeSubFilter(prefilter);

      if (!['header', 'raw'].includes(field)) {
        throw new Error(`Invalid response field ${field}`);
      }

      if (!id) {
        throw new Error('No request specified');
      }

      const request = await context.util.models.request.getById(id);
      if (!request) {
        throw new Error(`Could not find request ${id}`);
      }

      const response = await context.util.models.response.getLatestForRequestId(id);

      if (!response) {
        throw new Error('No responses for request');
      }

      if (!response.statusCode) {
        throw new Error('No successful responses for request');
      }

      const sanitizedFilter = filter.trim();

      if (field === 'header' && !sanitizedFilter) {
        throw new Error(`No ${field} filter specified`);
      }

      let output = '', filteredOutput = null;
      if (field === 'header') {
        output = matchHeader(response.headers, sanitizedFilter, sanitizedSubFilter);
        if(output instanceof Array && output.length === 1) {
          output = output[0];
        }
      } else if (field === 'raw') {
        const bodyBuffer = context.util.models.response.getBodyBuffer(response, '');
        const match = response.contentType.match(/charset=([\w-]+)/);
        const charset = match && match.length >= 2 ? match[1] : 'utf-8';

        // Sometimes iconv conversion fails so fallback to regular buffer
        try {
          output = iconv.decode(bodyBuffer, charset);
        } catch (err) {
          console.warn('[response] Failed to decode body', err);
          output = bodyBuffer.toString();
        }

        if(output instanceof Array) {
          filteredOutput = output.filter(b => sanitizedSubFilter.filter(b));
          filteredOutput = filteredOutput.map(b => sanitizedSubFilter.map(b));
          if(filteredOutput.length === 1) {
            filteredOutput = filteredOutput[0];
          }
          output = filteredOutput;
        } else {
          if(sanitizedSubFilter.filter(output)) {
            filteredOutput = sanitizedSubFilter.map(output);
            output = filteredOutput;
          }
        }
      } else {
        throw new Error(`Unknown field ${field}`);
      }
      let r = output;
      if (js) {
        try {
          r = eval(js);
        } catch (err) {
          throw new Error(`Cannot eval: ${err.message}`);
        }
      }

      return r
    }
  }
];

function sanitizeSubFilter(subFilter) {
  const sanitizedSubFilter = subFilter.trim();
  if(sanitizedSubFilter.length === 0) {
    return {
      filter: () => true,
      map: (input) => input
    };
  }
  const subReg = new RegExp('\/(.*)\/([a-zA-Z]*)');
  if(subReg.test(sanitizedSubFilter)) {
    console.log('Regex: ', subReg.source);
    const tags = subReg.exec(sanitizedSubFilter);
    console.log('FOUND REGEX:', sanitizedSubFilter, tags);
    const reg = new RegExp(tags[1], tags.length > 2 ? tags[2] : 'g');
    return {
      filter: (input) => {
        return reg.test(input);
      },
      map: (input) => {
        console.log('Checking: ' + input);
        let res = reg.exec(input);
        console.log('Returning:', res);
        return res;
      }
    };
  }
  return {
    filter: (input) => {
      return input.indexOf(sanitizedSubFilter) > -1;
    },
    map: (input) => {
      return input;
    }
  }
}

function matchHeader(headers, name, subFilter) {
  if (!headers.length) {
    throw new Error(`No headers available`);
  }

  const header = headers.filter(h => h.name.toLowerCase() === name.toLowerCase());

  console.log('HEADER:', header);
  if (!header || header.length === 0) {
    const names = headers.map(c => `"${c.name}"`).join(',\n\t');
    throw new Error(`No header with name "${name}".\nChoices are [\n\t${names}\n]`);
  }
  return matchSubHeader(header, subFilter);
}

function matchSubHeader(header, f) {
  let results = header.filter(h => f.filter(h.value));
  console.log('Filtered: ', results);
  let _mapped = results.map(result => f.map(result.value));
  console.log('Filtered and Mapped: ', _mapped);
  return _mapped;
}
